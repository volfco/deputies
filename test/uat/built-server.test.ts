import { spawn, type ChildProcess } from 'node:child_process';
import { Pool } from 'pg';
import { runMigrations } from '../../src/db/migrate.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const uatPort = 4593;

describe.skipIf(!testDatabaseUrl)('built server UAT', () => {
  let pool: Pool;
  let server: ChildProcess;

  beforeAll(async () => {
    await runMigrations(testDatabaseUrl!);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE events, runs, messages, session_sequence_counters, sessions RESTART IDENTITY CASCADE');
    server = spawn(process.execPath, ['dist/index.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_STORE: 'postgres',
        DATABASE_URL: testDatabaseUrl!,
        PORT: String(uatPort),
        RUN_MODE: 'all',
        RUNNER: 'fake',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForHealth();
  });

  afterEach(async () => {
    server.kill();
    await new Promise<void>((resolve) => server.once('exit', () => resolve()));
  });

  afterAll(async () => {
    await pool.end();
  });

  it('accepts a message and completes it through the worker', async () => {
    const createSession = await postJson('/sessions', { title: 'Built server UAT' });
    expect(createSession.status).toBe(201);
    const { session } = (await createSession.json()) as { session: { id: string } };

    const createMessage = await postJson(`/sessions/${session.id}/messages`, { prompt: 'complete from built app' });
    expect(createMessage.status).toBe(202);

    const events = await waitForEvents(session.id, ['message_completed']);
    expect(events.map((event) => event.type)).toEqual([
      'session_created',
      'message_created',
      'message_started',
      'run_started',
      'agent_text_delta',
      'run_completed',
      'message_completed',
    ]);
  });
});

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${uatPort}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitForHealth(): Promise<void> {
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${uatPort}/health`).catch(() => null);
    return response?.ok === true;
  });
}

async function waitForEvents(sessionId: string, terminalTypes: string[]): Promise<Array<{ type: string }>> {
  let lastEvents: Array<{ type: string }> = [];
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${uatPort}/sessions/${sessionId}/events`);
    const body = (await response.json()) as { events: Array<{ type: string }> };
    lastEvents = body.events;
    return terminalTypes.every((type) => lastEvents.some((event) => event.type === type));
  });

  return lastEvents;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Timed out waiting for condition');
}
