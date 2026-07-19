#!/usr/bin/env node
import { loadConfig } from './config/index.js';
import { readLedger } from './ledger/index.js';
import { aggregate, filterBySession } from './ledger/report.js';

function printUsage(): void {
  console.log(`gearbox — an automatic transmission for Claude models

Usage:
  gearbox start                  Start the proxy server
  gearbox report [--session id]  Print the cost/savings ledger report
  gearbox config                 Print the effective config as JSON
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

  const config = loadConfig(process.env.GEARBOX_CONFIG);
  const entries = filterBySession(readLedger(config.ledgerPath), sessionId);

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

  console.log(sessionId ? `Gearbox report — session "${sessionId}"` : 'Gearbox report — all sessions');
  console.log('');
  console.log(formatTable([header, ...body]));
  console.log('');
  console.log(`Total actual:   $${summary.totalActualUsd.toFixed(4)}`);
  console.log(`Total baseline: $${summary.totalBaselineUsd.toFixed(4)}`);
  console.log(
    `Savings:        $${summary.savingsUsd.toFixed(4)} (${summary.savingsPct === null ? 'n/a' : summary.savingsPct.toFixed(1) + '%'})`,
  );
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
    default:
      printUsage();
      break;
  }
}

main().catch((err) => {
  console.error('gearbox:', err instanceof Error ? err.message : err);
  process.exit(1);
});
