import type { CompletionCallback, CompletionCallbackPayload, CompletionCallbackSender } from '../../callbacks/service.js';
import type { SlackReactionClient, SlackReplyClient } from './client.js';

export class SlackCompletionCallbackSender implements CompletionCallbackSender {
  readonly type = 'slack';

  constructor(private readonly client: SlackReplyClient & Partial<SlackReactionClient>) {}

  async deliver(callback: CompletionCallback, payload: CompletionCallbackPayload): Promise<void> {
    const channel = callback.target.channel;
    const threadTs = callback.target.threadTs;
    if (typeof channel !== 'string' || !channel || typeof threadTs !== 'string' || !threadTs) {
      throw new Error('Slack callback target is missing channel or threadTs');
    }
    const response = await this.client.postThreadReply({
      channel,
      threadTs,
      text: payload.text.trim() || 'Completed.',
    });
    if (!response.ok) throw new Error(`Slack callback failed${response.error ? `: ${response.error}` : ''}`);
    const messageTs = callback.target.messageTs;
    if (typeof messageTs === 'string' && messageTs && this.client.addReaction) {
      const reaction = await this.client.addReaction({ channel, timestamp: messageTs, name: 'white_check_mark' });
      if (!reaction.ok && reaction.error !== 'already_reacted') throw new Error(`Slack completion reaction failed${reaction.error ? `: ${reaction.error}` : ''}`);
    }
  }
}
