import { Pool, type QueryResultRow } from 'pg';
import type { NormalizedEvent, NormalizedEventType } from '../events/types.js';
import type {
  AppStore,
  CreateMessageRecord,
  CreateSessionRecord,
  MessageRecord,
  MessageStatus,
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
