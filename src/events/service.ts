import type { NormalizedEvent, NormalizedEventType } from './types.js';
import type { AppStore } from '../store/types.js';

type PersistedEvent = NormalizedEvent & { sequence: number };
type EventSubscriber = (event: PersistedEvent) => void;

export type AppendEventInput = {
  sessionId: string;
  type: NormalizedEventType;
  payload?: Record<string, unknown>;
  runId?: string;
  messageId?: string;
};

export class EventService {
  private readonly subscribers = new Map<string, Set<EventSubscriber>>();

  constructor(private readonly store: AppStore) {}

  async append(input: AppendEventInput): Promise<PersistedEvent> {
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

    const persisted = await this.store.appendEvent(event);
    this.publish(persisted);
    return persisted;
  }

  async list(sessionId: string, afterSequence?: number) {
    return this.store.getEvents(sessionId, afterSequence);
  }

  subscribe(sessionId: string, subscriber: EventSubscriber): () => void {
    const sessionSubscribers = this.subscribers.get(sessionId) ?? new Set<EventSubscriber>();
    sessionSubscribers.add(subscriber);
    this.subscribers.set(sessionId, sessionSubscribers);

    return () => {
      sessionSubscribers.delete(subscriber);
      if (sessionSubscribers.size === 0) this.subscribers.delete(sessionId);
    };
  }

  private publish(event: PersistedEvent): void {
    for (const subscriber of this.subscribers.get(event.sessionId) ?? []) {
      subscriber(event);
    }
  }
}
