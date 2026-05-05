import type { NormalizedEvent } from '../events/types.js';
import type {
  AppStore,
  CreateMessageRecord,
  CreateSessionRecord,
  ClaimedMessage,
  MessageRecord,
  RecoveredRun,
  RunRecord,
  SessionRecord,
} from './types.js';

export class MemoryStore implements AppStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly messages = new Map<string, MessageRecord[]>();
  private readonly runs = new Map<string, RunRecord>();
  private readonly events = new Map<string, Array<NormalizedEvent & { sequence: number }>>();

  async createSession(record: CreateSessionRecord): Promise<SessionRecord> {
    if (this.sessions.has(record.id)) {
      throw new Error(`Session already exists: ${record.id}`);
    }

    this.sessions.set(record.id, record);
    return record;
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }

  async updateSession(record: SessionRecord): Promise<SessionRecord> {
    if (!this.sessions.has(record.id)) {
      throw new Error(`Session does not exist: ${record.id}`);
    }

    this.sessions.set(record.id, record);
    return record;
  }

  async nextMessageSequence(sessionId: string): Promise<number> {
    return (this.messages.get(sessionId)?.length ?? 0) + 1;
  }

  async createMessage(record: CreateMessageRecord): Promise<MessageRecord> {
    const sessionMessages = this.messages.get(record.sessionId) ?? [];
    sessionMessages.push(record);
    this.messages.set(record.sessionId, sessionMessages);
    return record;
  }

  async getMessages(sessionId: string): Promise<MessageRecord[]> {
    return [...(this.messages.get(sessionId) ?? [])];
  }

  async claimNextPendingMessage(input: {
    runId: string;
    runnerType: string;
    leaseOwner: string;
    leaseExpiresAt: Date;
    now: Date;
  }): Promise<ClaimedMessage | null> {
    for (const [sessionId, sessionMessages] of this.messages) {
      if (this.hasActiveRun(sessionId, input.now)) continue;

      const message = sessionMessages.find((candidate) => candidate.status === 'pending');
      if (!message) continue;

      const processingMessage: MessageRecord = { ...message, status: 'processing' };
      sessionMessages[sessionMessages.indexOf(message)] = processingMessage;

      const session = this.sessions.get(sessionId);
      if (!session) throw new Error(`Session does not exist: ${sessionId}`);
      this.sessions.set(sessionId, { ...session, status: 'active', updatedAt: input.now });

      const run: RunRecord = {
        id: input.runId,
        sessionId,
        messageId: processingMessage.id,
        status: 'running',
        runnerType: input.runnerType,
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: input.leaseExpiresAt,
        heartbeatAt: input.now,
        attempt: 1,
        startedAt: input.now,
        metadata: {},
      };
      this.runs.set(run.id, run);
      return { message: processingMessage, run };
    }

    return null;
  }

  async completeRun(input: { runId: string; completedAt: Date }): Promise<ClaimedMessage> {
    return this.finishRun(input.runId, input.completedAt, 'completed');
  }

  async renewRunLease(input: {
    runId: string;
    leaseOwner: string;
    leaseExpiresAt: Date;
    heartbeatAt: Date;
  }): Promise<RunRecord | null> {
    const run = this.runs.get(input.runId);
    if (!run || run.status !== 'running' || run.leaseOwner !== input.leaseOwner) return null;

    const renewed: RunRecord = {
      ...run,
      leaseExpiresAt: input.leaseExpiresAt,
      heartbeatAt: input.heartbeatAt,
    };
    this.runs.set(input.runId, renewed);
    return renewed;
  }

  async recoverStaleRuns(input: { now: Date; limit: number }): Promise<RecoveredRun[]> {
    const recovered: RecoveredRun[] = [];

    for (const run of this.runs.values()) {
      if (recovered.length >= input.limit) break;
      if (run.status !== 'running' && run.status !== 'starting') continue;
      if (!run.leaseExpiresAt || run.leaseExpiresAt > input.now) continue;

      const sessionMessages = this.messages.get(run.sessionId) ?? [];
      const message = sessionMessages.find((candidate) => candidate.id === run.messageId);
      if (!message) continue;

      const pendingMessage: MessageRecord = { ...message, status: 'pending' };
      sessionMessages[sessionMessages.indexOf(message)] = pendingMessage;

      const { leaseExpiresAt: _leaseExpiresAt, leaseOwner: _leaseOwner, ...runWithoutLease } = run;
      const staleRun: RunRecord = {
        ...runWithoutLease,
        status: 'stale',
        failedAt: input.now,
        heartbeatAt: input.now,
        error: 'Run lease expired',
      };
      this.runs.set(run.id, staleRun);

      const session = this.sessions.get(run.sessionId);
      if (session) this.sessions.set(run.sessionId, { ...session, status: 'idle', updatedAt: input.now });

      recovered.push({ message: pendingMessage, run: staleRun });
    }

    return recovered;
  }

  async failRun(input: { runId: string; failedAt: Date; error: string }): Promise<ClaimedMessage> {
    const claimed = await this.finishRun(input.runId, input.failedAt, 'failed');
    this.runs.set(input.runId, { ...claimed.run, error: input.error });
    return { ...claimed, run: this.runs.get(input.runId)! };
  }

  async nextEventSequence(sessionId: string): Promise<number> {
    return (this.events.get(sessionId)?.length ?? 0) + 1;
  }

  async appendEvent(
    event: NormalizedEvent & { sequence: number },
  ): Promise<NormalizedEvent & { sequence: number }> {
    const sessionEvents = this.events.get(event.sessionId) ?? [];
    sessionEvents.push(event);
    this.events.set(event.sessionId, sessionEvents);
    return event;
  }

  async getEvents(
    sessionId: string,
    afterSequence = 0,
  ): Promise<Array<NormalizedEvent & { sequence: number }>> {
    return (this.events.get(sessionId) ?? []).filter((event) => event.sequence > afterSequence);
  }

  private hasActiveRun(sessionId: string, now: Date): boolean {
    for (const run of this.runs.values()) {
      if (run.sessionId !== sessionId) continue;
      if (run.status !== 'running' && run.status !== 'starting') continue;
      if (run.leaseExpiresAt && run.leaseExpiresAt <= now) continue;
      return true;
    }
    return false;
  }

  private finishRun(runId: string, finishedAt: Date, status: 'completed' | 'failed'): ClaimedMessage {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run does not exist: ${runId}`);

    const sessionMessages = this.messages.get(run.sessionId) ?? [];
    const message = sessionMessages.find((candidate) => candidate.id === run.messageId);
    if (!message) throw new Error(`Message does not exist: ${run.messageId}`);

    const terminalMessage: MessageRecord = { ...message, status };
    sessionMessages[sessionMessages.indexOf(message)] = terminalMessage;

    const { leaseExpiresAt: _leaseExpiresAt, leaseOwner: _leaseOwner, ...runWithoutLease } = run;
    const terminalRun: RunRecord = { ...runWithoutLease, status, heartbeatAt: finishedAt };
    if (status === 'completed') terminalRun.completedAt = finishedAt;
    if (status === 'failed') terminalRun.failedAt = finishedAt;
    this.runs.set(runId, terminalRun);

    const session = this.sessions.get(run.sessionId);
    if (!session) throw new Error(`Session does not exist: ${run.sessionId}`);
    this.sessions.set(run.sessionId, { ...session, status: status === 'completed' ? 'idle' : 'failed', updatedAt: finishedAt });

    return { message: terminalMessage, run: terminalRun };
  }
}
