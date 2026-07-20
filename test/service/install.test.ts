import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installService, uninstallService } from '../../src/service/index.js';
import type { ExecFn, ServicePaths } from '../../src/service/index.js';

let dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A fake package root with a `dist/cli.js` already "built", so installService's build check passes. */
function fakePackageRoot(): string {
  const root = tempDir('gearbox-service-root-');
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist', 'cli.js'), '// fake cli\n');
  return root;
}

function fakeServicePaths(): ServicePaths {
  const home = tempDir('gearbox-service-home-');
  return {
    label: 'com.gearbox.proxy',
    plistPath: join(home, 'com.gearbox.proxy.plist'),
    logDir: join(home, 'logs'),
  };
}

/** A recording exec stub: never shells out, just remembers what it was called with. */
function recordingExec(behavior?: (command: string, args: string[]) => void): { exec: ExecFn; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  const exec: ExecFn = (command, args) => {
    calls.push({ command, args });
    behavior?.(command, args);
    return '';
  };
  return { exec, calls };
}

describe('installService', () => {
  it('throws a helpful error on non-darwin platforms before touching the filesystem', () => {
    const paths = fakeServicePaths();
    const { exec, calls } = recordingExec();
    expect(() => installService(exec, { platform: 'linux', paths, packageRoot: fakePackageRoot() })).toThrow(
      /only supported on macOS/,
    );
    expect(calls).toHaveLength(0);
    expect(existsSync(paths.plistPath)).toBe(false);
  });

  it('throws a helpful error when dist/cli.js is missing, telling the user to build', () => {
    const paths = fakeServicePaths();
    const emptyRoot = tempDir('gearbox-service-empty-root-');
    const { exec, calls } = recordingExec();
    expect(() => installService(exec, { platform: 'darwin', paths, packageRoot: emptyRoot })).toThrow(/npm run build/);
    expect(calls).toHaveLength(0);
  });

  it('creates the log directory, writes the plist, and unloads then loads via launchctl', () => {
    const paths = fakeServicePaths();
    const root = fakePackageRoot();
    const { exec, calls } = recordingExec((_command, args) => {
      if (args[0] === 'unload') throw new Error('not loaded yet');
    });

    installService(exec, { platform: 'darwin', paths, packageRoot: root, nodePath: '/usr/local/bin/node' });

    expect(existsSync(paths.logDir)).toBe(true);
    expect(existsSync(paths.plistPath)).toBe(true);

    const plistContents = readFileSync(paths.plistPath, 'utf8');
    expect(plistContents).toContain('/usr/local/bin/node');
    expect(plistContents).toContain(join(root, 'dist', 'cli.js'));
    expect(plistContents).toContain('<string>start</string>');

    expect(calls).toEqual([
      { command: 'launchctl', args: ['unload', paths.plistPath] },
      { command: 'launchctl', args: ['load', paths.plistPath] },
    ]);
  });

  it('still loads even when the best-effort unload throws (first-ever install)', () => {
    const paths = fakeServicePaths();
    const root = fakePackageRoot();
    const { exec, calls } = recordingExec((_command, args) => {
      if (args[0] === 'unload') throw new Error('no such service');
    });

    expect(() => installService(exec, { platform: 'darwin', paths, packageRoot: root })).not.toThrow();
    expect(calls.some((c) => c.command === 'launchctl' && c.args[0] === 'load')).toBe(true);
  });
});

describe('uninstallService', () => {
  it('throws a helpful error on non-darwin platforms', () => {
    const paths = fakeServicePaths();
    const { exec, calls } = recordingExec();
    expect(() => uninstallService(exec, { platform: 'win32', paths })).toThrow(/only supported on macOS/);
    expect(calls).toHaveLength(0);
  });

  it('unloads via launchctl and removes the plist file', () => {
    const paths = fakeServicePaths();
    mkdirSync(join(paths.plistPath, '..'), { recursive: true });
    writeFileSync(paths.plistPath, '<plist/>');
    const { exec, calls } = recordingExec();

    uninstallService(exec, { platform: 'darwin', paths });

    expect(calls).toEqual([{ command: 'launchctl', args: ['unload', paths.plistPath] }]);
    expect(existsSync(paths.plistPath)).toBe(false);
  });

  it('does not throw when the plist is already missing or launchctl errors on unload', () => {
    const paths = fakeServicePaths();
    const exec: ExecFn = () => {
      throw new Error('Could not find service');
    };

    expect(() => uninstallService(exec, { platform: 'darwin', paths })).not.toThrow();
    expect(existsSync(paths.plistPath)).toBe(false);
  });
});
