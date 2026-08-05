// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { platformCommand } from '../../server/openLocalDirectory.ts';
import { isLoopbackAddress } from '../../server/routes/projects.ts';

describe('local folder safety helpers', () => {
  it('passes the directory as a separate platform command argument', () => {
    expect(platformCommand('win32', 'D:\\data\\house')).toEqual({
      executable: 'explorer.exe',
      args: ['D:\\data\\house'],
    });
    expect(platformCommand('darwin', '/data/house')).toEqual({
      executable: 'open',
      args: ['/data/house'],
    });
    expect(platformCommand('linux', '/data/house')).toEqual({
      executable: 'xdg-open',
      args: ['/data/house'],
    });
  });

  it('accepts loopback addresses and rejects external addresses', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.168.1.8')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});
