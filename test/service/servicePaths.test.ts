import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { servicePaths } from '../../src/service/index.js';

describe('servicePaths', () => {
  it('returns the fixed label, LaunchAgents plist path, and log dir under the home directory', () => {
    const paths = servicePaths();
    expect(paths.label).toBe('com.gearbox.proxy');
    expect(paths.plistPath).toBe(join(homedir(), 'Library', 'LaunchAgents', 'com.gearbox.proxy.plist'));
    expect(paths.logDir).toBe(join(homedir(), '.gearbox', 'logs'));
  });

  it('is stable across calls', () => {
    expect(servicePaths()).toEqual(servicePaths());
  });
});
