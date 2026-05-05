import { createServer, createServices } from './app/server.js';
import { loadConfig, requireDatabaseUrl } from './config/index.js';
import { MemoryStore } from './store/memory.js';
import { PostgresStore } from './store/postgres.js';

const config = loadConfig(process.env);
const store = config.appStore === 'postgres' ? new PostgresStore(requireDatabaseUrl(config)) : new MemoryStore();
const server = createServer(config, createServices(store));

server.listen(config.port, () => {
  console.log(`background-agent service listening on :${config.port} (${config.runMode})`);
});
