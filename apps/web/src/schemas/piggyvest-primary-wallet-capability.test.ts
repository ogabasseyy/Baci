import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PIGGYVEST_CLIENT_BUILD_HEADER,
  PIGGYVEST_CLIENT_PLATFORM_HEADER,
  PIGGYVEST_PRIMARY_CLIENT_BUILD_FLOOR_VARIABLES,
  PRIMARY_NOT_READY_CODES,
  PRIMARY_SCOPED_REFUSAL_CODES,
  piggyvestClientBuildFloorSchema,
  piggyvestClientBuildSchema,
  piggyvestClientPlatformSchema,
  piggyvestPrimaryExistingOnboardingSchema,
  piggyvestPrimaryRolloutCohortRowsSchema,
  piggyvestPrimaryScopedRefusalCodeSchema,
} from './piggyvest-primary-wallet-capability';

// The storefront app's own list of codes it treats as "use the legacy flow".
// This web test runs when the server contract changes; a storefront-only
// change is held by the app's own isPrimaryWalletNotReady test, which names
// each of these codes and runs under the storefront jest plan.
const MOBILE_CAPABILITY_SOURCE = resolve(
  __dirname,
  '../../../mobile-storefront/lib/piggyvest-primary-capability.ts'
);

// Tolerates a type annotation, a generic type argument, either quote style
// and line breaks, so a formatting-only rewrite keeps the check meaningful.
const MOBILE_NOT_READY_CODES_PATTERN =
  /\bconst PRIMARY_NOT_READY_CODES\b[^=]*=\s*new Set(?:<[^>]*>)?\(\s*\[([^\]]*)\]/;

function parseMobileNotReadyCodes(source: string): string[] {
  const body = MOBILE_NOT_READY_CODES_PATTERN.exec(source)?.[1] ?? '';
  const codes = [...body.matchAll(/['"]([A-Z_]+)['"]/g)].map(
    (match) => match[1] ?? ''
  );
  if (codes.length === 0) throw new Error('mobile not-ready codes not found');
  return codes;
}

function mobileNotReadyCodes(): string[] {
  return parseMobileNotReadyCodes(
    readFileSync(MOBILE_CAPABILITY_SOURCE, 'utf8')
  );
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

  it('never refuses a customer or build with the merchant-wide cacheable base code', () => {
    // Mobile caches PIGGYVEST_NOT_READY merchant-wide for 60s, so a
    // per-customer or per-build refusal must use a feature-scoped code.
    expect(PRIMARY_SCOPED_REFUSAL_CODES).not.toContain('PIGGYVEST_NOT_READY');
    for (const code of PRIMARY_SCOPED_REFUSAL_CODES)
      expect(PRIMARY_NOT_READY_CODES).toContain(code);
    expect(
      piggyvestPrimaryScopedRefusalCodeSchema.safeParse('PIGGYVEST_NOT_READY')
        .success
    ).toBe(false);
  });

  // A formatting-only rewrite of the mobile list must not break this check.
  it.each([
    ["const PRIMARY_NOT_READY_CODES = new Set(['A_CODE', 'B_CODE']);"],
    ["const PRIMARY_NOT_READY_CODES = new Set<string>(['A_CODE', 'B_CODE']);"],
    [
      'const PRIMARY_NOT_READY_CODES: ReadonlySet<string> = new Set([\n  "A_CODE",\n  "B_CODE",\n]);',
    ],
    [
      "const PRIMARY_NOT_READY_CODES = new Set<string>(\n  ['A_CODE', 'B_CODE'] as const\n);",
    ],
  ])('reads the mobile codes from %j', (source) => {
    expect(parseMobileNotReadyCodes(source)).toEqual(['A_CODE', 'B_CODE']);
  });

  it('fails loudly when the mobile list cannot be found or is empty', () => {
    expect(() =>
      parseMobileNotReadyCodes('const OTHER = new Set([]);')
    ).toThrow('mobile not-ready codes not found');
    expect(() =>
      parseMobileNotReadyCodes('const PRIMARY_NOT_READY_CODES = new Set([]);')
    ).toThrow('mobile not-ready codes not found');
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

  it('reads only the three existing-onboarding answers', () => {
    for (const value of ['verified', 'in_flight', 'none'])
      expect(piggyvestPrimaryExistingOnboardingSchema.parse(value)).toBe(value);
    for (const value of [true, 'VERIFIED', 'in-flight', '', null, undefined])
      expect(
        piggyvestPrimaryExistingOnboardingSchema.safeParse(value).success
      ).toBe(false);
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
