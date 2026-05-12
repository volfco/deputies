import type { Context } from 'hono';
import type { EventService } from '../events/service.js';
import type { EventRecord } from '../store/types.js';

export async function writeSessionEventStream(
  c: Context,
  events: EventService,
  sessionId: string,
  afterSequence: number,
): Promise<Response> {
  return writeEventStream(c, {
    after: afterSequence,
    id: (event) => event.sequence,
    list: () => events.list(sessionId, afterSequence),
    subscribe: (writeEvent) => events.subscribe(sessionId, writeEvent),
  });
}

export async function writeGlobalEventStream(
  c: Context,
  events: EventService,
  afterId: number,
  replay: boolean,
  includeAll: boolean,
): Promise<Response> {
  return writeEventStream(c, {
    after: afterId,
    id: (event) => event.id,
    list: () => (includeAll ? events.listAllEvents(afterId) : events.listAll(afterId)),
    replay,
    subscribe: (writeEvent) => (includeAll ? events.subscribeAllEvents(writeEvent) : events.subscribeAll(writeEvent)),
  });
}

async function writeEventStream(
  c: Context,
  options: {
    after: number;
    id: (event: EventRecord) => number;
    list: () => Promise<EventRecord[]>;
    replay?: boolean;
    subscribe: (writeEvent: (event: EventRecord) => void) => () => void;
  },
): Promise<Response> {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let cursor = options.after;
  let closed = false;
  let writeQueue: Promise<void> = Promise.resolve();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    writer.close().catch(() => {});
  };

  const write = (chunk: string): Promise<void> => {
    if (closed) return Promise.resolve();
    const nextWrite = writeQueue.then(async () => {
      if (!closed) await writer.write(encoder.encode(chunk));
    });
    writeQueue = nextWrite.catch(() => {});
    nextWrite.catch(cleanup);
    return nextWrite;
  };
  const writeEvent = (event: EventRecord) => {
    const eventId = options.id(event);
    if (eventId <= cursor || closed) return;
    cursor = eventId;
    write(`id: ${eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).catch(() => {});
  };

  unsubscribe = options.subscribe(writeEvent);
  heartbeat = setInterval(() => {
    write(': keep-alive\n\n').catch(() => {});
  }, 15_000);

  c.req.raw.signal.addEventListener('abort', cleanup, { once: true });

  void (async () => {
    try {
      await write(': connected\n\n');
      if (options.replay !== false) {
        for (const event of await options.list()) {
          writeEvent(event);
        }
      }
    } catch {
      cleanup();
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
