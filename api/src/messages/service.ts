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

  async updatePending(input: { sessionId: string; messageId: string; prompt: string }): Promise<MessageRecord> {
    const message = await this.store.updatePendingMessage(input);
    if (!message) throw new MessageServiceError('conflict', 'Message is not pending or does not exist');
    await this.events.append({
      sessionId: input.sessionId,
      messageId: message.id,
      type: 'message_updated',
      payload: { sequence: message.sequence },
    });
    return message;
  }

  async cancelPending(input: { sessionId: string; messageId: string }): Promise<MessageRecord> {
    const message = await this.store.cancelPendingMessage({ ...input, cancelledAt: new Date() });
    if (!message) throw new MessageServiceError('conflict', 'Message is not pending or does not exist');
    await this.events.append({
      sessionId: input.sessionId,
      messageId: message.id,
      type: 'message_cancelled',
      payload: { sequence: message.sequence },
    });
    return message;
  }

  async cancelActiveRun(input: { sessionId: string }): Promise<MessageRecord[]> {
    const session = await this.store.getSession(input.sessionId);
    if (!session) throw new MessageServiceError('not_found', `Session not found: ${input.sessionId}`);

    const cancelled = await this.store.cancelActiveRun({ sessionId: input.sessionId, cancelledAt: new Date(), error: 'Run cancelled by user' });
    if (!cancelled) throw new MessageServiceError('conflict', 'Session has no active run to cancel');

    const primary = cancelled.messages[0];
    await this.events.append({
      sessionId: input.sessionId,
      runId: cancelled.run.id,
      ...(primary ? { messageId: primary.id } : {}),
      type: 'run_cancelled',
      payload: { sequences: cancelled.messages.map((message) => message.sequence), batchSize: cancelled.messages.length },
    });
    for (const message of cancelled.messages) {
      await this.events.append({
        sessionId: input.sessionId,
        runId: cancelled.run.id,
        messageId: message.id,
        type: 'message_cancelled',
        payload: { sequence: message.sequence },
      });
    }

    return cancelled.messages;
  }
}

export class MessageServiceError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}
