// macOS launchd daemonization: install/uninstall/status for running gearbox as a
// background service so users don't need a terminal open. Darwin-only — launchd
// is a macOS concept; other platforms get a clear error rather than silent no-ops.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RenderPlistOptions {
  label: string;
  nodePath: string;
  cliJsPath: string;
  logDir: string;
}

export interface ServicePaths {
  label: string;
  plistPath: string;
  logDir: string;
}

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  pid?: number;
}

/** Runs an external command and returns its stdout as a string; throws on non-zero exit. */
export type ExecFn = (command: string, args: string[]) => string;

/** Overrides accepted by install/uninstall so tests never touch the real filesystem
 * locations or actually shell out to launchctl. */
export interface ServiceOverrides {
  paths?: ServicePaths;
  /** Package root to resolve `dist/cli.js` against. Defaults to this module's own package root. */
  packageRoot?: string;
  nodePath?: string;
  platform?: NodeJS.Platform;
}

const defaultExec: ExecFn = (command, args) => execFileSync(command, args, { encoding: 'utf8' });

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Renders a launchd plist that runs `node cliJsPath start`, restarting on crash (KeepAlive)
 * and on login (RunAtLoad), with stdout/stderr captured under `logDir`. */
export function renderPlist(opts: RenderPlistOptions): string {
  const { label, nodePath, cliJsPath, logDir } = opts;
  const programArgs = [nodePath, cliJsPath, 'start'];
  const stdoutPath = `${logDir}/gearbox.log`;
  const stderrPath = `${logDir}/gearbox.err.log`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${xmlEscape(label)}</string>
	<key>ProgramArguments</key>
	<array>
${programArgs.map((arg) => `\t\t<string>${xmlEscape(arg)}</string>`).join('\n')}
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${xmlEscape(stdoutPath)}</string>
	<key>StandardErrorPath</key>
	<string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

/** Fixed identity + filesystem locations for the gearbox launchd service. */
export function servicePaths(): ServicePaths {
  const label = 'com.gearbox.proxy';
  return {
    label,
    plistPath: join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`),
    logDir: join(homedir(), '.gearbox', 'logs'),
  };
}

/** Root of the installed gearbox package, derived from this module's own compiled
 * location (dist/service/index.js → package root is two levels up). */
function defaultPackageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..');
}

function assertDarwin(platformValue: NodeJS.Platform, action: string): void {
  if (platformValue !== 'darwin') {
    throw new Error(`gearbox service ${action} is only supported on macOS (darwin); detected platform "${platformValue}"`);
  }
}

/** Installs and loads the gearbox launchd agent: verifies the build exists, creates the
 * log directory, writes the plist, then (re)loads it via launchctl. Unload-before-load is
 * best-effort — a first install has nothing loaded yet, so that failure is swallowed. */
export function installService(execFn: ExecFn = defaultExec, overrides: ServiceOverrides = {}): void {
  const platformValue = overrides.platform ?? platform();
  assertDarwin(platformValue, 'install');

  const paths = overrides.paths ?? servicePaths();
  const root = overrides.packageRoot ?? defaultPackageRoot();
  const cliJsPath = join(root, 'dist', 'cli.js');

  if (!existsSync(cliJsPath)) {
    throw new Error(`gearbox: build output not found at "${cliJsPath}" — run "npm run build" first.`);
  }

  mkdirSync(paths.logDir, { recursive: true });

  const nodePath = overrides.nodePath ?? process.execPath;
  const plist = renderPlist({ label: paths.label, nodePath, cliJsPath, logDir: paths.logDir });
  writeFileSync(paths.plistPath, plist);

  try {
    execFn('launchctl', ['unload', paths.plistPath]);
  } catch {
    // Not previously loaded (or stale plist) — fine, load below will (re)register it.
  }
  execFn('launchctl', ['load', paths.plistPath]);
}

/** Unloads the gearbox launchd agent and removes its plist. Unload is best-effort: if the
 * agent was never loaded, launchctl errors and we ignore it since the end state is the same. */
export function uninstallService(execFn: ExecFn = defaultExec, overrides: ServiceOverrides = {}): void {
  const platformValue = overrides.platform ?? platform();
  assertDarwin(platformValue, 'uninstall');

  const paths = overrides.paths ?? servicePaths();

  try {
    execFn('launchctl', ['unload', paths.plistPath]);
  } catch {
    // Already unloaded — fine.
  }
  if (existsSync(paths.plistPath)) {
    rmSync(paths.plistPath);
  }
}

/** Parses `launchctl list <label>` output. launchctl errors (non-zero exit / throw) mean the
 * agent isn't loaded at all → not installed. A loaded-but-not-running agent omits the "PID" key. */
export function serviceStatus(execFn: ExecFn = defaultExec): ServiceStatus {
  const { label } = servicePaths();
  let output: string;
  try {
    output = execFn('launchctl', ['list', label]);
  } catch {
    return { installed: false, running: false };
  }

  const pidMatch = output.match(/"PID"\s*=\s*(\d+)\s*;/);
  if (pidMatch) {
    return { installed: true, running: true, pid: Number(pidMatch[1]) };
  }
  return { installed: true, running: false };
}
