import { loadConfig } from './config/index.js';
import { createRouter } from './router/index.js';
import { createLedger } from './ledger/index.js';
import { createProxy } from './proxy/index.js';

const config = loadConfig(process.env.GEARBOX_CONFIG);
const router = createRouter(config);
const ledger = createLedger(config);
const proxy = createProxy(config, router, ledger);

proxy.start().then(
  () => console.log(`gearbox: shifting on http://localhost:${config.port} → ${config.upstreamBaseUrl}`),
  (err) => {
    console.error('gearbox failed to start:', err.message);
    process.exit(1);
  },
);
