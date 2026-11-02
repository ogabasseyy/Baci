import { describe, expect, it, vi } from 'vitest';
import {
  readPrimaryClientBuild,
  readPrimaryClientBuildFloors,
  resolvePrimaryClientCapability,
} from './primary-wallet-capability';
import {
  client,
  floors,
  refused,
} from './primary-wallet-capability.test-support';

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
