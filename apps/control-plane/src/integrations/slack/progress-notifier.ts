import type { RunProgressNotifier } from '../../worker/service.js';
import type { SlackAssistantThreadClient, SlackReplyClient } from './client.js';

export class SlackRunProgressNotifier implements RunProgressNotifier {
  constructor(private readonly client: SlackAssistantThreadClient & Partial<SlackReplyClient>) {}

  async onRunStarted(input: Parameters<NonNullable<RunProgressNotifier['onRunStarted']>>[0]): Promise<void> {
    await this.setSlackThreadStatus(input.message, 'Working on your request...');
  }

  async onRunCancelled(input: Parameters<NonNullable<RunProgressNotifier['onRunCancelled']>>[0]): Promise<void> {
    await this.setSlackThreadStatus(input.message, '');
    await this.postCancellationReply(input.message);
  }

  private async setSlackThreadStatus(
    message: Parameters<NonNullable<RunProgressNotifier['onRunStarted']>>[0]['message'],
    status: string,
  ): Promise<void> {
    const callback = message.context?.callback;
    if (!callback || typeof callback !== 'object' || Array.isArray(callback)) return;
    const type = 'type' in callback ? callback.type : undefined;
    const channel = 'channel' in callback ? callback.channel : undefined;
    const threadTs = 'threadTs' in callback ? callback.threadTs : undefined;
    if (type !== 'slack' || typeof channel !== 'string' || !channel || typeof threadTs !== 'string' || !threadTs)
      return;

    const response = await this.client.setThreadStatus({ channel, threadTs, status });
    if (!response.ok) throw new Error(`Slack progress status failed${response.error ? `: ${response.error}` : ''}`);
  }

  private async postCancellationReply(
    message: Parameters<NonNullable<RunProgressNotifier['onRunStarted']>>[0]['message'],
  ): Promise<void> {
    if (!this.client.postThreadReply) return;
    const callback = message.context?.callback;
    if (!callback || typeof callback !== 'object' || Array.isArray(callback)) return;
    const type = 'type' in callback ? callback.type : undefined;
    const channel = 'channel' in callback ? callback.channel : undefined;
    const threadTs = 'threadTs' in callback ? callback.threadTs : undefined;
    if (type !== 'slack' || typeof channel !== 'string' || !channel || typeof threadTs !== 'string' || !threadTs)
      return;

    const text = ':no_entry: Execution was cancelled.';
    const response = await this.client.postThreadReply({
      channel,
      threadTs,
      text,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
    });
    if (!response.ok) throw new Error(`Slack cancellation reply failed${response.error ? `: ${response.error}` : ''}`);
  }
}
