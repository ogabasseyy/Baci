import { describe, expect, it, vi } from 'vitest';
import { readPrimaryClientBuildFloors } from './primary-client-build-floors';
import { floors } from './primary-wallet-capability.test-support';

vi.mock('server-only', () => ({}));

describe('primary client build floors', () => {
  it('reads both server-only floors', () => {
    expect(readPrimaryClientBuildFloors(floors)).toEqual({
      ios: 120,
      android: 700,
    });
  });

  it.each([
    ['both unset', {}],
    ['iOS unset', { PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_ANDROID: '700' }],
    ['Android unset', { PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_IOS: '120' }],
    ['iOS empty', { ...floors, PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_IOS: '' }],
    [
      'Android zero',
      { ...floors, PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_ANDROID: '0' },
    ],
    [
      'iOS padded',
      { ...floors, PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_IOS: ' 120' },
    ],
  ])('is unset when %s', (_label, env) => {
    expect(readPrimaryClientBuildFloors(env as NodeJS.ProcessEnv)).toBeNull();
  });
});
