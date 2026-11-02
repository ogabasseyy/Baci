import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PIGGYVEST_CLIENT_BUILD_HEADER,
  PIGGYVEST_CLIENT_PLATFORM_HEADER,
  PIGGYVEST_PRIMARY_CLIENT_BUILD_FLOOR_VARIABLES,
  PRIMARY_NOT_READY_CODES,
  piggyvestClientBuildFloorSchema,
  piggyvestClientBuildSchema,
  piggyvestClientPlatformSchema,
  piggyvestPrimaryRolloutCohortRowsSchema,
} from './piggyvest-primary-wallet-capability';

// The storefront app's own list of codes it treats as "use the legacy flow".
const MOBILE_CAPABILITY_SOURCE = resolve(
  __dirname,
  '../../../mobile-storefront/lib/piggyvest-primary-capability.ts'
);

function mobileNotReadyCodes(): string[] {
  const source = readFileSync(MOBILE_CAPABILITY_SOURCE, 'utf8');
  const body = /const PRIMARY_NOT_READY_CODES = new Set\(\[([^\]]*)\]\)/.exec(
    source
  )?.[1];
  if (body === undefined) throw new Error('mobile not-ready codes not found');
  return [...body.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1] ?? '');
}

describe('PiggyVest primary client capability contract', () => {
  it('names the client build headers new storefront builds send', () => {
    expect(PIGGYVEST_CLIENT_PLATFORM_HEADER).toBe('X-Baci-Client-Platform');
    expect(PIGGYVEST_CLIENT_BUILD_HEADER).toBe('X-Baci-Client-Build');
  });

  it('names one server-only build floor per platform', () => {
    expect(PIGGYVEST_PRIMARY_CLIENT_BUILD_FLOOR_VARIABLES).toEqual({
      ios: 'PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_IOS',
      android: 'PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_ANDROID',
    });
  });

  it('refuses only with codes released storefront builds already fall back on', () => {
    const mobile = mobileNotReadyCodes();
    expect(mobile.length).toBeGreaterThan(0);
    for (const code of PRIMARY_NOT_READY_CODES) expect(mobile).toContain(code);
  });

  it.each(['ios', 'android'])('accepts the %s platform', (platform) => {
    expect(piggyvestClientPlatformSchema.parse(platform)).toBe(platform);
  });

  it.each([
    'iOS',
    'Android',
    'web',
    '',
    ' ios',
    'ios, android',
  ])('rejects the platform %j', (platform) => {
    expect(piggyvestClientPlatformSchema.safeParse(platform).success).toBe(
      false
    );
  });

  it.each([
    ['0', 0],
    ['7', 7],
    ['646', 646],
    ['9999999999', 9_999_999_999],
  ])('reads the canonical build %s', (value, expected) => {
    expect(piggyvestClientBuildSchema.parse(value)).toBe(expected);
  });

  it.each([
    '',
    ' 646',
    '646 ',
    '0646',
    '+646',
    '-1',
    '646.0',
    '646-beta',
    '1e3',
    '0x10',
    'Infinity',
    '10000000000',
    '646, 700',
  ])('treats the malformed build %j as an old build', (value) => {
    expect(piggyvestClientBuildSchema.safeParse(value).success).toBe(false);
  });

  it('accepts only a positive canonical floor', () => {
    expect(piggyvestClientBuildFloorSchema.parse('1')).toBe(1);
    expect(piggyvestClientBuildFloorSchema.parse('646')).toBe(646);
    for (const value of ['0', '', ' 646', '0646', '646.5', 'unset'])
      expect(piggyvestClientBuildFloorSchema.safeParse(value).success).toBe(
        false
      );
  });

  it('reads exactly one boolean cohort membership row', () => {
    expect(
      piggyvestPrimaryRolloutCohortRowsSchema.parse([{ result: true }])
    ).toEqual([{ result: true }]);
    for (const rows of [
      [],
      [{ result: true }, { result: false }],
      [{ result: null }],
      [{ result: 'true' }],
      [{ result: true, customerId: 'fixture' }],
    ])
      expect(
        piggyvestPrimaryRolloutCohortRowsSchema.safeParse(rows).success
      ).toBe(false);
  });
});
