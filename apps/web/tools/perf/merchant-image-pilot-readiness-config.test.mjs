import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READINESS_PROFILES,
  parseArgs,
  parseMountsJson,
  parseProfiles,
  parseStoreMap,
  READINESS_CLI_OPTIONS,
  READINESS_PROFILES,
  SETTINGS_CLI_OPTIONS,
} from './merchant-image-pilot-readiness-config.mjs';

describe('merchant-image-pilot-readiness profiles', () => {
  it('covers the spec matrix by default', () => {
    // Design 2026-10-01: mobile 360/390/412 at DPR 1/2/3, desktop 1365
    // at DPR 1/2, plus the no-AVIF fallback exercise (design: verify the
    // WebP fallback in a real browser without AVIF support).
    expect(DEFAULT_READINESS_PROFILES).toEqual([
      'desktop-1365-dpr1',
      'desktop-1365-dpr2',
      'mobile-390-dpr2-noavif',
      'mobile-360-dpr1',
      'mobile-360-dpr2',
      'mobile-360-dpr3',
      'mobile-390-dpr1',
      'mobile-390-dpr2',
      'mobile-390-dpr3',
      'mobile-412-dpr1',
      'mobile-412-dpr2',
      'mobile-412-dpr3',
    ]);
    expect(parseProfiles(undefined)).toEqual(DEFAULT_READINESS_PROFILES);
    expect(parseProfiles('')).toEqual(DEFAULT_READINESS_PROFILES);
    expect(READINESS_PROFILES['mobile-412-dpr3'].deviceScaleFactor).toBe(3);
    expect(READINESS_PROFILES['mobile-360-dpr1'].viewport).toEqual({
      height: 844,
      width: 360,
    });
    expect(READINESS_PROFILES['desktop-1365-dpr1'].isMobile).toBe(false);
    expect(READINESS_PROFILES['desktop-1365-dpr1'].viewport).toEqual({
      height: 800,
      width: 1365,
    });
    expect(READINESS_PROFILES['mobile-390-dpr2-noavif']).toMatchObject({
      deviceScaleFactor: 2,
      isMobile: true,
      stripAvif: true,
      viewport: { height: 844, width: 390 },
    });
    expect(READINESS_PROFILES['mobile-390-dpr2'].stripAvif ?? false).toBe(
      false
    );
  });

  it('rejects incomplete coverage and accepts the complete explicit matrix', () => {
    expect(() => parseProfiles('mobile-390-dpr2,desktop-1365-dpr1')).toThrow(
      /complete readiness matrix/
    );
    expect(() => parseProfiles('mobile-390-dpr2,mobile-390-dpr2')).toThrow(
      /complete readiness matrix/
    );
    expect(parseProfiles(DEFAULT_READINESS_PROFILES.join(','))).toEqual(
      DEFAULT_READINESS_PROFILES
    );
    expect(() => parseProfiles('mobile-390-dpr2,watch')).toThrow(
      /bad --profiles/
    );
    expect(() => parseProfiles('mobile-dpr2')).toThrow(/bad --profiles/);
    expect(() => parseProfiles(',,,')).toThrow(/bad --profiles/);
  });
});

describe('merchant-image-pilot-readiness CLI parsing', () => {
  it('parses known --key=value options', () => {
    expect(
      parseArgs(
        ['--origin=https://x', '--store-map=a=b', '--chrome=/bin/chrome'],
        READINESS_CLI_OPTIONS
      )
    ).toEqual({
      chrome: '/bin/chrome',
      origin: 'https://x',
      'store-map': 'a=b',
    });
    expect(parseArgs([], READINESS_CLI_OPTIONS)).toEqual({});
    expect(
      parseArgs(['--har=a.har', '--expect-dpr=2'], SETTINGS_CLI_OPTIONS)
    ).toEqual({ 'expect-dpr': '2', har: 'a.har' });
  });

  it('rejects typoed flags instead of silently ignoring them', () => {
    // The motivating typo: --hero-store (singular) must not read as an
    // unset --hero-stores and skip the required hero surface.
    expect(() =>
      parseArgs(['--hero-store=ogabassey'], READINESS_CLI_OPTIONS)
    ).toThrow(/unknown option --hero-store/);
    expect(() =>
      parseArgs(['--origin=https://x', '--bogus=1'], READINESS_CLI_OPTIONS)
    ).toThrow(/unknown option --bogus/);
  });

  it('rejects malformed tokens and cross-tool flags', () => {
    expect(() => parseArgs(['--profiles'], READINESS_CLI_OPTIONS)).toThrow(
      /expected --key=value/
    );
    expect(() => parseArgs(['ogabassey'], READINESS_CLI_OPTIONS)).toThrow(
      /expected --key=value/
    );
    expect(() => parseArgs(['--har=a.har'], READINESS_CLI_OPTIONS)).toThrow(
      /unknown option --har/
    );
    expect(() =>
      parseArgs(['--origin=https://x'], SETTINGS_CLI_OPTIONS)
    ).toThrow(/unknown option --origin/);
  });
});

describe('merchant-image-pilot-readiness expected mounts', () => {
  it('accepts --mounts and parses the offline accepted shape', () => {
    expect(
      parseArgs(['--mounts=/tmp/mounts.json'], READINESS_CLI_OPTIONS)
    ).toEqual({ mounts: '/tmp/mounts.json' });
    expect(
      parseMountsJson(
        JSON.stringify([
          {
            assetId: 'logo-a',
            binding: 'm/logo-a',
            generationId: 'g',
            merchantId: 'm',
            role: 'logo',
            slotId: 'header-logo',
            stagedOriginal: '/__pilot/originals/x.png',
          },
        ])
      )
    ).toEqual([
      {
        binding: 'm/logo-a',
        generationId: 'g',
        merchantId: 'm',
        slotId: 'header-logo',
        stagedOriginal: '/__pilot/originals/x.png',
      },
    ]);
  });

  it('rejects malformed mounts files instead of gating nothing', () => {
    expect(() => parseMountsJson('not json')).toThrow(/not valid JSON/);
    expect(() => parseMountsJson('{}')).toThrow(/non-empty JSON array/);
    expect(() => parseMountsJson('[]')).toThrow(/non-empty JSON array/);
    expect(() => parseMountsJson('[{}]')).toThrow(
      /binding, merchantId, slotId, generationId, and stagedOriginal/
    );
    expect(() =>
      parseMountsJson(
        JSON.stringify([
          { binding: 'm/logo-a', merchantId: 'm', slotId: 'header-logo' },
        ])
      )
    ).toThrow(/generationId/);
  });
});

describe('merchant-image-pilot-readiness store coverage', () => {
  const mounts = [{ merchantId: 'm1' }, { merchantId: 'm2' }];

  it('parses a covering map', () => {
    expect(parseStoreMap('m1=slug-a,m2=slug-b', mounts)).toEqual([
      { merchantId: 'm1', slug: 'slug-a' },
      { merchantId: 'm2', slug: 'slug-b' },
    ]);
  });

  it('rejects empty maps that would run zero browser checks', () => {
    for (const value of ['', ' , ', ',']) {
      expect(() => parseStoreMap(value, mounts)).toThrow(/at least one/);
    }
  });

  it('rejects duplicate merchants and uncovered mount merchants', () => {
    expect(() => parseStoreMap('m1=a,m1=b', mounts)).toThrow(
      /more than one store/
    );
    expect(() => parseStoreMap('m1=slug-a', mounts)).toThrow(
      /no store mapped.*m2/
    );
  });
});
