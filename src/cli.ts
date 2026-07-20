#!/usr/bin/env node
import { loadConfig } from './config/index.js';
import { readLedger } from './ledger/index.js';
import { aggregate, filterBySession, selectLastSession } from './ledger/report.js';

function printUsage(): void {
  console.log(`gearbox — an automatic transmission for Claude models

Usage:
  gearbox start                          Start the proxy server
  gearbox report [--session id] [--last] Print the cost/savings ledger report
  gearbox config                         Print the effective config as JSON
  gearbox service install|status|uninstall
                                         Manage the macOS background service
`);
}

async function startCommand(): Promise<void> {
  // Dynamic import: router/proxy are owned by sibling workstreams that may be mid-edit.
  const [{ loadConfig: load }, { createRouter }, { createLedger }, { createProxy }] = await Promise.all([
    import('./config/index.js'),
    import('./router/index.js'),
    import('./ledger/index.js'),
    import('./proxy/index.js'),
  ]);

  const config = load(process.env.GEARBOX_CONFIG);
  const router = createRouter(config);
  const ledger = createLedger(config);
  const proxy = createProxy(config, router, ledger);

  await proxy.start();
  console.log(`gearbox: shifting on http://localhost:${config.port} → ${config.upstreamBaseUrl}`);
}

function configCommand(): void {
  const config = loadConfig(process.env.GEARBOX_CONFIG);
  console.log(JSON.stringify(config, null, 2));
}

function formatTable(rows: string[][]): string {
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
  return rows.map((row) => row.map((cell, col) => cell.padEnd(widths[col]!)).join('  ')).join('\n');
}

function reportCommand(args: string[]): void {
  const sessionFlagIdx = args.indexOf('--session');
  const sessionId = sessionFlagIdx !== -1 ? args[sessionFlagIdx + 1] : undefined;
  const last = args.includes('--last');

  const config = loadConfig(process.env.GEARBOX_CONFIG);
  let entries = filterBySession(readLedger(config.ledgerPath), sessionId);
  if (last) entries = selectLastSession(entries);

  if (entries.length === 0) {
    console.log(
      sessionId
        ? `No ledger entries found for session "${sessionId}".`
        : `No ledger entries found at ${config.ledgerPath}. Run some requests through gearbox first.`,
    );
    return;
  }

  const summary = aggregate(entries);
  const header = ['TIER', 'REQUESTS', 'INPUT TOKENS', 'OUTPUT TOKENS', 'ACTUAL $'];
  const body = summary.rows.map((r) => [
    r.tier,
    String(r.requests),
    String(r.inputTokens),
    String(r.outputTokens),
    r.actualCostUsd.toFixed(4),
  ]);

  const scope = last
    ? `session "${summary.sessions[summary.sessions.length - 1]!.sessionId}" (most recent)`
    : sessionId
      ? `session "${sessionId}"`
      : 'all sessions';
  console.log(`Gearbox report — ${scope}`);
  console.log('');
  console.log(formatTable([header, ...body]));
  console.log('');
  console.log(`Total actual:   $${summary.totalActualUsd.toFixed(4)}`);
  console.log(`Total baseline: $${summary.totalBaselineUsd.toFixed(4)}`);
  console.log(
    `Savings:        $${summary.savingsUsd.toFixed(4)} (${summary.savingsPct === null ? 'n/a' : summary.savingsPct.toFixed(1) + '%'})`,
  );
  if (summary.fallbackRequests > 0) {
    console.log(
      `Fallbacks:      ${summary.fallbackRequests} request${summary.fallbackRequests === 1 ? '' : 's'} bounced to the original model`,
    );
  }
}

async function serviceCommand(args: string[]): Promise<void> {
  const { installService, uninstallService, serviceStatus, servicePaths } = await import('./service/index.js');
  const paths = servicePaths();

  switch (args[0]) {
    case 'install':
      installService();
      console.log(`gearbox: service installed and loaded (${paths.plistPath})`);
      console.log(`gearbox: logs in ${paths.logDir}`);
      break;
    case 'uninstall':
      uninstallService();
      console.log('gearbox: service unloaded and removed');
      break;
    case 'status': {
      const s = serviceStatus();
      console.log(
        !s.installed
          ? 'gearbox: service not installed (run: gearbox service install)'
          : s.running
            ? `gearbox: service running (pid ${s.pid})`
            : 'gearbox: service loaded but not running — check logs in ' + paths.logDir,
      );
      break;
    }
    default:
      printUsage();
      break;
  }
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case 'start':
      await startCommand();
      break;
    case 'report':
      reportCommand(args);
      break;
    case 'config':
      configCommand();
      break;
    case 'service':
      await serviceCommand(args);
      break;
    default:
      printUsage();
      break;
  }
}

main().catch((err) => {
  console.error('gearbox:', err instanceof Error ? err.message : err);
  process.exit(1);
});
