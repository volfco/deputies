import type { Server } from 'node:http';
import { createServer } from '../src/app/server.js';
import { loadConfig } from '../src/config/index.js';

describe('core API', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createServer(loadConfig({}));
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }
    baseUrl = `http://${address.address}:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('reports health', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok', runMode: 'all' });
  });

  it('creates a session, enqueues a message, and replays events', async () => {
    const createSession = await postJson(`${baseUrl}/sessions`, { title: 'Test session' });
    expect(createSession.status).toBe(201);

    const { session } = (await createSession.json()) as { session: { id: string; title: string } };
    expect(session.title).toBe('Test session');

    const createMessage = await postJson(`${baseUrl}/sessions/${session.id}/messages`, {
      prompt: 'Investigate the failing test',
    });
    expect(createMessage.status).toBe(202);

    const { message } = (await createMessage.json()) as {
      message: { sessionId: string; sequence: number; status: string; prompt: string };
    };
    expect(message).toMatchObject({
      sessionId: session.id,
      sequence: 1,
      status: 'pending',
      prompt: 'Investigate the failing test',
    });

    const eventsResponse = await fetch(`${baseUrl}/sessions/${session.id}/events`);
    expect(eventsResponse.status).toBe(200);

    const { events } = (await eventsResponse.json()) as { events: Array<{ type: string; sequence: number }> };
    expect(events.map((event) => event.type)).toEqual(['session_created', 'message_created']);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);

    const replayResponse = await fetch(`${baseUrl}/sessions/${session.id}/events?after=1`);
    const { events: replayed } = (await replayResponse.json()) as { events: Array<{ type: string }> };
    expect(replayed.map((event) => event.type)).toEqual(['message_created']);
  });

  it('returns 404 when enqueueing a message for a missing session', async () => {
    const response = await postJson(`${baseUrl}/sessions/missing/messages`, { prompt: 'hello' });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: 'not_found' });
  });

  it('validates message prompts', async () => {
    const createSession = await postJson(`${baseUrl}/sessions`, {});
    const { session } = (await createSession.json()) as { session: { id: string } };

    const response = await postJson(`${baseUrl}/sessions/${session.id}/messages`, { prompt: '' });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' });
  });
});

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
