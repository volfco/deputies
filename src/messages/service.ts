import { randomUUID } from 'node:crypto';
import type { EventService } from '../events/service.js';
import type { AppStore, MessageRecord } from '../store/types.js';

export type EnqueueMessageInput = {
  sessionId: string;
  prompt: string;
  source?: string;
  context?: Record<string, unknown>;
};

export class MessageService {
  constructor(
    private readonly store: AppStore,
    private readonly events: EventService,
  ) {}

  async enqueue(input: EnqueueMessageInput): Promise<MessageRecord> {
    const session = await this.store.getSession(input.sessionId);
    if (!session) {
      throw new MessageServiceError('not_found', `Session not found: ${input.sessionId}`);
    }

    const sequence = await this.store.nextMessageSequence(input.sessionId);
    const record: MessageRecord = {
      id: randomUUID(),
      sessionId: input.sessionId,
      sequence,
      status: 'pending',
      prompt: input.prompt,
      createdAt: new Date(),
    };

    if (input.source) record.source = input.source;
    if (input.context) record.context = input.context;

    const message = await this.store.createMessage(record);
    await this.events.append({
      sessionId: input.sessionId,
      messageId: message.id,
      type: 'message_created',
      payload: { sequence: message.sequence, source: message.source ?? null },
    });

    return message;
  }

  async list(sessionId: string): Promise<MessageRecord[]> {
    return this.store.getMessages(sessionId);
  }
}

export class MessageServiceError extends Error {
  constructor(
    readonly code: 'not_found',
    message: string,
  ) {
    super(message);
  }
}
