import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { NormalizedEvent, NormalizedEventType } from '../events/types.js';
import type {
  AppStore,
  ClaimedMessage,
  CreateMessageRecord,
  CreateSessionRecord,
  MessageRecord,
  MessageStatus,
  RecoveredRun,
  RunRecord,
  RunStatus,
  SessionRecord,
  SessionStatus,
} from './types.js';

type SessionRow = QueryResultRow & {
  id: string;
  status: SessionStatus;
  title: string | null;
  created_at: Date;
  updated_at: Date;
};

type PgInteger = number | string;

type MessageRow = QueryResultRow & {
  id: string;
  session_id: string;
  sequence: PgInteger;
  status: MessageStatus;
  prompt: string;
  source: string | null;
  context: Record<string, unknown> | null;
  created_at: Date;
};

type EventRow = QueryResultRow & {
  session_id: string;
  run_id: string | null;
  message_id: string | null;
  sequence: PgInteger;
  type: NormalizedEventType;
  payload: Record<string, unknown>;
  created_at: Date;
};

type RunRow = QueryResultRow & {
  id: string;
  session_id: string;
  message_id: string;
  status: RunStatus;
  runner_type: string;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  heartbeat_at: Date | null;
  attempt: number;
  started_at: Date;
  completed_at: Date | null;
  failed_at: Date | null;
  error: string | null;
  metadata: Record<string, unknown>;
};

export class PostgresStore implements AppStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string | Pool) {
    this.pool = typeof databaseUrl === 'string' ? new Pool({ connectionString: databaseUrl }) : databaseUrl;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async createSession(record: CreateSessionRecord): Promise<SessionRecord> {
    const result = await this.pool.query<SessionRow>(
      `INSERT INTO sessions (id, status, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, status, title, created_at, updated_at`,
      [record.id, record.status, record.title ?? null, record.createdAt, record.updatedAt],
    );

    return toSession(result.rows[0]!);
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const result = await this.pool.query<SessionRow>(
      'SELECT id, status, title, created_at, updated_at FROM sessions WHERE id = $1',
      [id],
    );

    const row = result.rows[0];
    return row ? toSession(row) : null;
  }

  async updateSession(record: SessionRecord): Promise<SessionRecord> {
    const result = await this.pool.query<SessionRow>(
      `UPDATE sessions
       SET status = $2, title = $3, created_at = $4, updated_at = $5
       WHERE id = $1
       RETURNING id, status, title, created_at, updated_at`,
      [record.id, record.status, record.title ?? null, record.createdAt, record.updatedAt],
    );

    const row = result.rows[0];
    if (!row) throw new Error(`Session does not exist: ${record.id}`);
    return toSession(row);
  }

  async nextMessageSequence(sessionId: string): Promise<number> {
    return this.nextSequence(sessionId, 'messages');
  }

  async createMessage(record: CreateMessageRecord): Promise<MessageRecord> {
    const result = await this.pool.query<MessageRow>(
      `INSERT INTO messages (id, session_id, sequence, status, prompt, source, context, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, session_id, sequence, status, prompt, source, context, created_at`,
      [
        record.id,
        record.sessionId,
        record.sequence,
        record.status,
        record.prompt,
        record.source ?? null,
        record.context ?? null,
        record.createdAt,
      ],
    );

    return toMessage(result.rows[0]!);
  }

  async getMessages(sessionId: string): Promise<MessageRecord[]> {
    const result = await this.pool.query<MessageRow>(
      `SELECT id, session_id, sequence, status, prompt, source, context, created_at
       FROM messages
       WHERE session_id = $1
       ORDER BY sequence ASC`,
      [sessionId],
    );

    return result.rows.map(toMessage);
  }

  async claimNextPendingMessage(input: {
    runId: string;
    runnerType: string;
    leaseOwner: string;
    leaseExpiresAt: Date;
    now: Date;
  }): Promise<ClaimedMessage | null> {
    return this.transaction(async (client) => {
      const candidate = await client.query<MessageRow>(
        `SELECT m.id, m.session_id, m.sequence, m.status, m.prompt, m.source, m.context, m.created_at
         FROM messages m
         WHERE m.status = 'pending'
           AND NOT EXISTS (
             SELECT 1 FROM runs r
             WHERE r.session_id = m.session_id
               AND r.status IN ('starting', 'running')
               AND (r.lease_expires_at IS NULL OR r.lease_expires_at > $1)
           )
         ORDER BY m.created_at ASC, m.sequence ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [input.now],
      );

      const message = candidate.rows[0];
      if (!message) return null;

      const updatedMessage = await client.query<MessageRow>(
        `UPDATE messages
         SET status = 'processing'
         WHERE id = $1
         RETURNING id, session_id, sequence, status, prompt, source, context, created_at`,
        [message.id],
      );

      const run = await client.query<RunRow>(
        `INSERT INTO runs (id, session_id, message_id, status, runner_type, lease_owner, lease_expires_at, heartbeat_at, started_at)
         VALUES ($1, $2, $3, 'running', $4, $5, $6, $7, $7)
         RETURNING id, session_id, message_id, status, runner_type, lease_owner, lease_expires_at, heartbeat_at, attempt, started_at, completed_at, failed_at, error, metadata`,
        [input.runId, message.session_id, message.id, input.runnerType, input.leaseOwner, input.leaseExpiresAt, input.now],
      );

      await client.query('UPDATE sessions SET status = $2, updated_at = $3 WHERE id = $1', [
        message.session_id,
        'active',
        input.now,
      ]);

      return { message: toMessage(updatedMessage.rows[0]!), run: toRun(run.rows[0]!) };
    });
  }

  async completeRun(input: { runId: string; completedAt: Date }): Promise<ClaimedMessage> {
    return this.finishRun(input.runId, 'completed', input.completedAt);
  }

  async renewRunLease(input: {
    runId: string;
    leaseOwner: string;
    leaseExpiresAt: Date;
    heartbeatAt: Date;
  }): Promise<RunRecord | null> {
    const result = await this.pool.query<RunRow>(
      `UPDATE runs
       SET lease_expires_at = $3,
           heartbeat_at = $4
       WHERE id = $1 AND lease_owner = $2 AND status = 'running'
       RETURNING id, session_id, message_id, status, runner_type, lease_owner, lease_expires_at, heartbeat_at, attempt, started_at, completed_at, failed_at, error, metadata`,
      [input.runId, input.leaseOwner, input.leaseExpiresAt, input.heartbeatAt],
    );

    const row = result.rows[0];
    return row ? toRun(row) : null;
  }

  async recoverStaleRuns(input: { now: Date; limit: number }): Promise<RecoveredRun[]> {
    return this.transaction(async (client) => {
      const stale = await client.query<RunRow>(
        `SELECT id, session_id, message_id, status, runner_type, lease_owner, lease_expires_at, heartbeat_at, attempt, started_at, completed_at, failed_at, error, metadata
         FROM runs
         WHERE status IN ('starting', 'running') AND lease_expires_at <= $1
         ORDER BY lease_expires_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2`,
        [input.now, input.limit],
      );

      const recovered: RecoveredRun[] = [];
      for (const staleRun of stale.rows) {
        const runResult = await client.query<RunRow>(
          `UPDATE runs
           SET status = 'stale',
               lease_owner = NULL,
               lease_expires_at = NULL,
               heartbeat_at = $2,
               failed_at = $2,
               error = 'Run lease expired'
           WHERE id = $1
           RETURNING id, session_id, message_id, status, runner_type, lease_owner, lease_expires_at, heartbeat_at, attempt, started_at, completed_at, failed_at, error, metadata`,
          [staleRun.id, input.now],
        );

        const messageResult = await client.query<MessageRow>(
          `UPDATE messages
           SET status = 'pending'
           WHERE id = $1 AND status = 'processing'
           RETURNING id, session_id, sequence, status, prompt, source, context, created_at`,
          [staleRun.message_id],
        );

        const message = messageResult.rows[0];
        if (!message) continue;

        await client.query('UPDATE sessions SET status = $2, updated_at = $3 WHERE id = $1', [
          staleRun.session_id,
          'idle',
          input.now,
        ]);

        recovered.push({ message: toMessage(message), run: toRun(runResult.rows[0]!) });
      }

      return recovered;
    });
  }

  async failRun(input: { runId: string; failedAt: Date; error: string }): Promise<ClaimedMessage> {
    return this.finishRun(input.runId, 'failed', input.failedAt, input.error);
  }

  async nextEventSequence(sessionId: string): Promise<number> {
    return this.nextSequence(sessionId, 'events');
  }

  async appendEvent(event: NormalizedEvent & { sequence: number }): Promise<NormalizedEvent & { sequence: number }> {
    const result = await this.pool.query<EventRow>(
      `INSERT INTO events (session_id, run_id, message_id, sequence, type, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING session_id, run_id, message_id, sequence, type, payload, created_at`,
      [
        event.sessionId,
        event.runId ?? null,
        event.messageId ?? null,
        event.sequence,
        event.type,
        event.payload,
        event.createdAt,
      ],
    );

    return toEvent(result.rows[0]!);
  }

  async getEvents(sessionId: string, afterSequence = 0): Promise<Array<NormalizedEvent & { sequence: number }>> {
    const result = await this.pool.query<EventRow>(
      `SELECT session_id, run_id, message_id, sequence, type, payload, created_at
       FROM events
       WHERE session_id = $1 AND sequence > $2
       ORDER BY sequence ASC`,
      [sessionId, afterSequence],
    );

    return result.rows.map(toEvent);
  }

  private async nextSequence(sessionId: string, kind: 'messages' | 'events'): Promise<number> {
    const result = await this.pool.query<{ sequence: PgInteger }>(
      `INSERT INTO session_sequence_counters (session_id, kind, next_sequence)
       VALUES ($1, $2, 2)
       ON CONFLICT (session_id, kind)
       DO UPDATE SET next_sequence = session_sequence_counters.next_sequence + 1
       RETURNING next_sequence - 1 AS sequence`,
      [sessionId, kind],
    );

    return Number(result.rows[0]!.sequence);
  }

  private async finishRun(
    runId: string,
    status: 'completed' | 'failed',
    finishedAt: Date,
    error?: string,
  ): Promise<ClaimedMessage> {
    return this.transaction(async (client) => {
      const runResult = await client.query<RunRow>(
        `UPDATE runs
         SET status = $2,
             lease_owner = NULL,
             lease_expires_at = NULL,
             heartbeat_at = $3,
             completed_at = CASE WHEN $2 = 'completed' THEN $3 ELSE completed_at END,
             failed_at = CASE WHEN $2 = 'failed' THEN $3 ELSE failed_at END,
             error = $4
         WHERE id = $1
         RETURNING id, session_id, message_id, status, runner_type, lease_owner, lease_expires_at, heartbeat_at, attempt, started_at, completed_at, failed_at, error, metadata`,
        [runId, status, finishedAt, error ?? null],
      );

      const run = runResult.rows[0];
      if (!run) throw new Error(`Run does not exist: ${runId}`);

      const messageResult = await client.query<MessageRow>(
        `UPDATE messages
         SET status = $2
         WHERE id = $1
         RETURNING id, session_id, sequence, status, prompt, source, context, created_at`,
        [run.message_id, status],
      );

      await client.query('UPDATE sessions SET status = $2, updated_at = $3 WHERE id = $1', [
        run.session_id,
        status === 'completed' ? 'idle' : 'failed',
        finishedAt,
      ]);

      return { message: toMessage(messageResult.rows[0]!), run: toRun(run) };
    });
  }

  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function toSession(row: SessionRow): SessionRecord {
  const record: SessionRecord = {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.title) record.title = row.title;
  return record;
}

function toMessage(row: MessageRow): MessageRecord {
  const record: MessageRecord = {
    id: row.id,
    sessionId: row.session_id,
    sequence: Number(row.sequence),
    status: row.status,
    prompt: row.prompt,
    createdAt: row.created_at,
  };
  if (row.source) record.source = row.source;
  if (row.context) record.context = row.context;
  return record;
}

function toEvent(row: EventRow): NormalizedEvent & { sequence: number } {
  const event: NormalizedEvent & { sequence: number } = {
    sessionId: row.session_id,
    sequence: Number(row.sequence),
    type: row.type,
    payload: row.payload,
    createdAt: row.created_at,
  };
  if (row.run_id) event.runId = row.run_id;
  if (row.message_id) event.messageId = row.message_id;
  return event;
}

function toRun(row: RunRow): RunRecord {
  const run: RunRecord = {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    status: row.status,
    runnerType: row.runner_type,
    attempt: row.attempt,
    startedAt: row.started_at,
    metadata: row.metadata,
  };
  if (row.lease_owner) run.leaseOwner = row.lease_owner;
  if (row.lease_expires_at) run.leaseExpiresAt = row.lease_expires_at;
  if (row.heartbeat_at) run.heartbeatAt = row.heartbeat_at;
  if (row.completed_at) run.completedAt = row.completed_at;
  if (row.failed_at) run.failedAt = row.failed_at;
  if (row.error) run.error = row.error;
  return run;
}
