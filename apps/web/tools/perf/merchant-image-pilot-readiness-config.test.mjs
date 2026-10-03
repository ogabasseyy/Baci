import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READINESS_PROFILES,
  parseProfiles,
  READINESS_PROFILES,
} from './merchant-image-pilot-readiness-config.mjs';

describe('merchant-image-pilot-readiness profiles', () => {
  it('covers mobile DPR 1/2/3 and desktop by default', () => {
    expect(DEFAULT_READINESS_PROFILES).toEqual([
      'desktop-dpr1',
      'desktop-dpr2',
      'mobile-dpr1',
      'mobile-dpr2',
      'mobile-dpr3',
    ]);
    expect(parseProfiles(undefined)).toEqual(DEFAULT_READINESS_PROFILES);
    expect(parseProfiles('')).toEqual(DEFAULT_READINESS_PROFILES);
    expect(READINESS_PROFILES['mobile-dpr3'].deviceScaleFactor).toBe(3);
    expect(READINESS_PROFILES['desktop-dpr1'].isMobile).toBe(false);
    expect(READINESS_PROFILES['desktop-dpr1'].viewport).toEqual({
      height: 800,
      width: 1280,
    });
  });

  it('accepts an explicit profile subset and rejects unknowns', () => {
    expect(parseProfiles('mobile-dpr2,desktop-dpr1')).toEqual([
      'mobile-dpr2',
      'desktop-dpr1',
    ]);
    expect(parseProfiles('mobile-dpr2,mobile-dpr2')).toEqual(['mobile-dpr2']);
    expect(() => parseProfiles('mobile-dpr2,watch')).toThrow(/bad --profiles/);
    expect(() => parseProfiles(',,,')).toThrow(/bad --profiles/);
  });
});
