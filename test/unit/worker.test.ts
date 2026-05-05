import { createServices } from '../../src/app/server.js';
import { FakeRunner } from '../../src/runner/fake.js';
import { FakeSandboxProvider } from '../../src/sandbox/fake.js';
import { MemoryStore } from '../../src/store/memory.js';
import { WorkerService } from '../../src/worker/service.js';

describe('WorkerService', () => {
  it('processes one pending message with the fake runner', async () => {
    const store = new MemoryStore();
    const services = createServices(store);
    const session = await services.sessions.create({ title: 'Worker test' });
    await services.messages.enqueue({ sessionId: session.id, prompt: 'do the thing' });

    const worker = new WorkerService({
      store,
      events: services.events,
      runner: new FakeRunner(),
      runnerType: 'fake',
      sandboxProvider: new FakeSandboxProvider(),
      leaseOwner: 'test-worker',
    });

    await expect(worker.processNext()).resolves.toBe(true);
    await expect(worker.processNext()).resolves.toBe(false);

    await expect(services.messages.list(session.id)).resolves.toMatchObject([{ status: 'completed' }]);

    const events = await services.events.list(session.id);
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
