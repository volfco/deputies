import { Pool } from 'pg';
import { createServices } from '../../src/app/server.js';
import { runMigrations } from '../../src/db/migrate.js';
import { PostgresStore } from '../../src/store/postgres.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('PostgresStore', () => {
  let pool: Pool;
  let store: PostgresStore;

  beforeAll(async () => {
    await runMigrations(testDatabaseUrl!);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE events, messages, session_sequence_counters, sessions RESTART IDENTITY CASCADE');
    store = new PostgresStore(testDatabaseUrl!);
  });

  afterEach(async () => {
    await store.close();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('preserves session, message, and event behavior', async () => {
    const services = createServices(store);
    const session = await services.sessions.create({ title: 'Postgres test' });
    const message = await services.messages.enqueue({
      sessionId: session.id,
      prompt: 'Persist this message',
      source: 'test',
      context: { issue: 123 },
    });

    expect(await services.sessions.get(session.id)).toMatchObject({
      id: session.id,
      title: 'Postgres test',
      status: 'created',
    });
    expect(await services.messages.list(session.id)).toMatchObject([
      {
        id: message.id,
        sessionId: session.id,
        sequence: 1,
        status: 'pending',
        prompt: 'Persist this message',
        source: 'test',
        context: { issue: 123 },
      },
    ]);

    const events = await services.events.list(session.id);
    expect(events.map((event) => event.type)).toEqual(['session_created', 'message_created']);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);

    await store.close();
    store = new PostgresStore(testDatabaseUrl!);
    const restartedServices = createServices(store);

    const replayed = await restartedServices.events.list(session.id, 1);
    expect(replayed.map((event) => event.type)).toEqual(['message_created']);
  });
});
