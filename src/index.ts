import { createServer, createServices } from './app/server.js';
import { loadConfig, requireDatabaseUrl, requireDaytonaApiKey, requireFlueModel } from './config/index.js';
import { FakeRunner } from './runner/fake.js';
import { DaytonaSandboxProvider } from './sandbox/daytona.js';
import { FakeSandboxProvider } from './sandbox/fake.js';
import type { SandboxProvider } from './sandbox/types.js';
import { MemoryStore } from './store/memory.js';
import { PostgresStore } from './store/postgres.js';
import { startWorkerLoop, WorkerService } from './worker/service.js';

const config = loadConfig(process.env);
const store = config.appStore === 'postgres' ? new PostgresStore(requireDatabaseUrl(config)) : new MemoryStore();
const services = createServices(store);

if (config.runMode === 'all' || config.runMode === 'api') {
  const server = createServer(config, services);
  server.listen(config.port, () => {
    console.log(`background-agent service listening on :${config.port} (${config.runMode})`);
  });
}

if (config.runMode === 'all' || config.runMode === 'worker') {
  if (config.runner !== 'fake') {
    requireDatabaseUrl(config);
    requireFlueModel(config);
    throw new Error('RUNNER=flue is configured but the Flue agent factory is not wired yet');
  }

  const worker = new WorkerService({
    store,
    events: services.events,
    runner: new FakeRunner(),
    runnerType: config.runner,
    sandboxProvider: createSandboxProvider(),
    leaseOwner: `worker-${process.pid}`,
  });
  startWorkerLoop(worker);
  console.log(`background-agent worker started (${config.runMode})`);
}

function createSandboxProvider(): SandboxProvider {
  if (config.sandboxProvider === 'fake') return new FakeSandboxProvider();
  if (config.sandboxProvider === 'daytona') {
    const options = {
      apiKey: requireDaytonaApiKey(config),
    };
    if (config.daytonaApiUrl) Object.assign(options, { apiUrl: config.daytonaApiUrl });
    if (config.daytonaTarget) Object.assign(options, { target: config.daytonaTarget });
    if (config.daytonaImage) Object.assign(options, { image: config.daytonaImage });
    if (config.daytonaSnapshot) Object.assign(options, { snapshot: config.daytonaSnapshot });
    return new DaytonaSandboxProvider(options);
  }

  throw new Error(`SANDBOX_PROVIDER=${config.sandboxProvider} is not wired yet`);
}
