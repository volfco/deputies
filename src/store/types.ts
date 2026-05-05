import type { NormalizedEvent } from '../events/types.js';

export type SessionStatus = 'created' | 'active' | 'idle' | 'completed' | 'failed' | 'cancelled' | 'archived';
export type MessageStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

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

  nextEventSequence(sessionId: string): Promise<number>;
  appendEvent(event: NormalizedEvent & { sequence: number }): Promise<NormalizedEvent & { sequence: number }>;
  getEvents(sessionId: string, afterSequence?: number): Promise<Array<NormalizedEvent & { sequence: number }>>;
}
