import type { NormalizedEvent } from '../events/types.js';

export type SessionStatus = 'created' | 'active' | 'idle' | 'completed' | 'failed' | 'cancelled' | 'archived';
export type MessageStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type RunStatus = 'starting' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'stale';

export type SessionRecord = {
  id: string;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
  title?: string;
};

export type MessageRecord = {
  id: string;
  sessionId: string;
  sequence: number;
  status: MessageStatus;
  prompt: string;
  createdAt: Date;
  source?: string;
  context?: Record<string, unknown>;
};

export type RunRecord = {
  id: string;
  sessionId: string;
  messageId: string;
  status: RunStatus;
  runnerType: string;
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  heartbeatAt?: Date;
  attempt: number;
  startedAt: Date;
  completedAt?: Date;
  failedAt?: Date;
  error?: string;
  metadata: Record<string, unknown>;
};

export type ClaimedMessage = {
  message: MessageRecord;
  run: RunRecord;
};

export type RecoveredRun = {
  message: MessageRecord;
  run: RunRecord;
};

export type CreateSessionRecord = {
  id: string;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
  title?: string;
};

export type CreateMessageRecord = {
  id: string;
  sessionId: string;
  sequence: number;
  status: MessageStatus;
  prompt: string;
  createdAt: Date;
  source?: string;
  context?: Record<string, unknown>;
};

export interface AppStore {
  createSession(record: CreateSessionRecord): Promise<SessionRecord>;
  getSession(id: string): Promise<SessionRecord | null>;
  updateSession(record: SessionRecord): Promise<SessionRecord>;

  nextMessageSequence(sessionId: string): Promise<number>;
  createMessage(record: CreateMessageRecord): Promise<MessageRecord>;
  getMessages(sessionId: string): Promise<MessageRecord[]>;

  claimNextPendingMessage(input: {
    runId: string;
    runnerType: string;
    leaseOwner: string;
    leaseExpiresAt: Date;
    now: Date;
  }): Promise<ClaimedMessage | null>;
  renewRunLease(input: { runId: string; leaseOwner: string; leaseExpiresAt: Date; heartbeatAt: Date }): Promise<RunRecord | null>;
  recoverStaleRuns(input: { now: Date; limit: number }): Promise<RecoveredRun[]>;
  completeRun(input: { runId: string; completedAt: Date }): Promise<ClaimedMessage>;
  failRun(input: { runId: string; failedAt: Date; error: string }): Promise<ClaimedMessage>;

  nextEventSequence(sessionId: string): Promise<number>;
  appendEvent(event: NormalizedEvent & { sequence: number }): Promise<NormalizedEvent & { sequence: number }>;
  getEvents(sessionId: string, afterSequence?: number): Promise<Array<NormalizedEvent & { sequence: number }>>;
}
