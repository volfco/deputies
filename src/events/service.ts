import type { NormalizedEvent, NormalizedEventType } from './types.js';
import type { AppStore } from '../store/types.js';

export type AppendEventInput = {
  sessionId: string;
  type: NormalizedEventType;
  payload?: Record<string, unknown>;
  runId?: string;
  messageId?: string;
};

export class EventService {
  constructor(private readonly store: AppStore) {}

  async append(input: AppendEventInput): Promise<NormalizedEvent & { sequence: number }> {
    const sequence = await this.store.nextEventSequence(input.sessionId);
    const event: NormalizedEvent & { sequence: number } = {
      sessionId: input.sessionId,
      sequence,
      type: input.type,
      payload: input.payload ?? {},
      createdAt: new Date(),
    };

    if (input.runId) event.runId = input.runId;
    if (input.messageId) event.messageId = input.messageId;

    return this.store.appendEvent(event);
  }

  async list(sessionId: string, afterSequence?: number) {
    return this.store.getEvents(sessionId, afterSequence);
  }
}
