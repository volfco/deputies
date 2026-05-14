import { describe, expect, it } from 'vitest';

import { EventService } from '../../src/events/service.js';
import { MemoryStore } from '../../src/store/memory.js';

describe('EventService', () => {
  it('removes NUL bytes from nested event payload strings', async () => {
    const events = new EventService(new MemoryStore());

    const event = await events.append({
      sessionId: 'session-1',
      type: 'tool_finished',
      payload: {
        toolName: 'shell',
        result: {
          text: 'before\u0000after',
          nested: ['a\u0000b', { stderr: '\u0000error' }],
        },
      },
    });

    expect(event.payload).toMatchObject({
      result: {
        text: 'beforeafter',
        nested: ['ab', { stderr: 'error' }],
      },
    });
    expect(JSON.stringify(event.payload)).not.toContain('\u0000');
  });
});
