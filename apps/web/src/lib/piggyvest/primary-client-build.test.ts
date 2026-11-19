import { describe, expect, it, vi } from 'vitest';
import { readPrimaryClientBuild } from './primary-client-build';
import { client } from './primary-wallet-capability.test-support';

vi.mock('server-only', () => ({}));

describe('primary client build header', () => {
  it('reads the platform and canonical build a new storefront build sends', () => {
    expect(readPrimaryClientBuild(client('android', '701'))).toEqual({
      platform: 'android',
      build: 701,
    });
  });

  it.each([
    ['no headers', client()],
    ['platform only', client('ios')],
    ['build only', client(undefined, '500')],
    ['an unknown platform', client('web', '500')],
    ['a mixed-case platform', client('IOS', '500')],
    ['a dotted build', client('ios', '500.1')],
    ['a suffixed build', client('ios', '500-beta')],
    ['repeated builds', client('ios', '500, 501')],
  ])('treats %s as an old build', (_label, headers) => {
    expect(readPrimaryClientBuild(headers)).toBeNull();
  });
});
