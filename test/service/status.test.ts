import { describe, expect, it } from 'vitest';
import { serviceStatus } from '../../src/service/index.js';
import type { ExecFn } from '../../src/service/index.js';

describe('serviceStatus', () => {
  it('reports installed + running with pid when launchctl list includes a PID', () => {
    const exec: ExecFn = (command, args) => {
      expect(command).toBe('launchctl');
      expect(args).toEqual(['list', 'com.gearbox.proxy']);
      return `{
	"Label" = "com.gearbox.proxy";
	"OnDemand" = false;
	"LastExitStatus" = 0;
	"PID" = 12345;
};
`;
    };

    expect(serviceStatus(exec)).toEqual({ installed: true, running: true, pid: 12345 });
  });

  it('reports installed but not running when launchctl list has no PID', () => {
    const exec: ExecFn = () => `{
	"Label" = "com.gearbox.proxy";
	"OnDemand" = false;
	"LastExitStatus" = 0;
};
`;

    expect(serviceStatus(exec)).toEqual({ installed: true, running: false });
  });

  it('reports not installed when launchctl errors (service not loaded)', () => {
    const exec: ExecFn = () => {
      throw new Error('Could not find service "com.gearbox.proxy" in domain for port');
    };

    expect(serviceStatus(exec)).toEqual({ installed: false, running: false });
  });
});
