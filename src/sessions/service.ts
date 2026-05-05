import { randomUUID } from 'node:crypto';
import type { EventService } from '../events/service.js';
import type { AppStore, SessionRecord } from '../store/types.js';

export type CreateSessionInput = {
  title?: string;
};

export class SessionService {
  constructor(
    private readonly store: AppStore,
    private readonly events: EventService,
  ) {}

  async create(input: CreateSessionInput = {}): Promise<SessionRecord> {
    const now = new Date();
    const record: SessionRecord = {
      id: randomUUID(),
      status: 'created',
      createdAt: now,
      updatedAt: now,
    };

    if (input.title) record.title = input.title;

    const session = await this.store.createSession(record);
    await this.events.append({
      sessionId: session.id,
      type: 'session_created',
      payload: { title: session.title ?? null },
    });

    return session;
  }

  async get(id: string): Promise<SessionRecord | null> {
    return this.store.getSession(id);
  }
}
