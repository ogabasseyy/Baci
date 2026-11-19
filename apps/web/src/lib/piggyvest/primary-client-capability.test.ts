import { describe, expect, it, vi } from 'vitest';
import { resolvePrimaryClientCapability } from './primary-client-capability';
import {
  client,
  floors,
  refused,
} from './primary-wallet-capability.test-support';

vi.mock('server-only', () => ({}));

describe('resolvePrimaryClientCapability', () => {
  const resolve = (headers: Headers, env: NodeJS.ProcessEnv = floors) =>
    resolvePrimaryClientCapability({
      headers,
      env,
      refusalCode: 'SAVINGS_NOT_READY',
    });

  it.each([
    ['iOS at its floor', client('ios', '120')],
    ['iOS above its floor', client('ios', '121')],
    ['Android at its floor', client('android', '700')],
  ])('enables %s', (_label, headers) => {
    expect(resolve(headers)).toEqual({ enabled: true });
  });

  it.each([
    ['a missing header', client()],
    ['a malformed header', client('android', '700.0')],
    ['iOS below its floor', client('ios', '119')],
    ['Android at the iOS floor', client('android', '120')],
    ['Android below its floor', client('android', '699')],
  ])('refuses %s with the caller code', (_label, headers) => {
    expect(resolve(headers)).toEqual(
      refused('client_build', 'SAVINGS_NOT_READY')
    );
  });

  it.each([
    ['both floors unset', {}],
    [
      'the Android floor unset',
      { PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_IOS: '1' },
    ],
    [
      'the iOS floor unset',
      { PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_ANDROID: '1' },
    ],
  ])('closes every build when %s', (_label, env) => {
    for (const headers of [
      client(),
      client('ios', '1'),
      client('ios', '9999999999'),
      client('android', '9999999999'),
    ])
      expect(resolve(headers, env as NodeJS.ProcessEnv)).toEqual(
        refused('build_floor_unset', 'SAVINGS_NOT_READY')
      );
  });
});

describe('refusal code scope', () => {
  const unscoped = 'PIGGYVEST_NOT_READY' as unknown as 'SAVINGS_NOT_READY';

  it('answers unavailable, never the cacheable base code, when the caller passes it', () => {
    expect(
      resolvePrimaryClientCapability({
        headers: client('ios', '1'),
        env: floors,
        refusalCode: unscoped,
      })
    ).toEqual({
      enabled: false,
      status: 'unavailable',
      code: 'PIGGYVEST_UNAVAILABLE',
    });
  });
});
