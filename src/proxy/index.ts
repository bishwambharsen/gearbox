// STUB — Workstream 1 replaces the body; keep the exported signature.
import type { GearboxConfig, GearboxServer, Ledger, Router } from '../types.js';

export function createProxy(config: GearboxConfig, _router: Router, _ledger: Ledger): GearboxServer {
  return {
    async start() {
      throw new Error(`proxy not implemented yet (would listen on :${config.port})`);
    },
    async stop() {},
  };
}
