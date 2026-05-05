import type { NormalizedEvent } from '../events/types.js';
import type {
  AppStore,
  CreateMessageRecord,
  CreateSessionRecord,
  MessageRecord,
  SessionRecord,
} from './types.js';

export class MemoryStore implements AppStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly messages = new Map<string, MessageRecord[]>();
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
}
