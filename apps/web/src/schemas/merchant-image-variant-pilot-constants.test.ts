import { describe, expect, it } from 'vitest';
import {
  PILOT_MAX_AXIS_PIXELS,
  PILOT_MAX_DECODE_CHANNELS,
  PILOT_MAX_DECODED_PIXELS,
  PILOT_MAX_INPUT_BYTES,
  PILOT_MAX_JOBS,
  PILOT_MAX_MANIFEST_BYTES,
  PILOT_POLICY_VERSION,
  PILOT_RECIPE_ID,
  PILOT_SCHEMA_VERSION,
  PILOT_SHA256_PATTERN,
  PILOT_SHARP_LIMITS,
  PILOT_TIER_PATH_PATTERN,
  PILOT_TIERS,
  PILOT_UUID_PATTERN,
} from './merchant-image-variant-pilot-constants';

describe('merchant-image-variant-pilot-constants', () => {
  it('exports pinned versions, decode limits, tier ladders, and validation patterns', () => {
    expect(PILOT_SCHEMA_VERSION).toBe(1);
    expect(PILOT_POLICY_VERSION).toBe(1);
    expect(PILOT_RECIPE_ID).toBe('pilot-r2-7d207bbbac68d8ba');
    expect(PILOT_MAX_JOBS).toBe(20);
    expect(PILOT_MAX_DECODED_PIXELS).toBe(40_000_000);
    expect(PILOT_MAX_AXIS_PIXELS).toBe(16384);
    expect(PILOT_MAX_INPUT_BYTES).toBe(10 * 1024 * 1024);
    expect(PILOT_MAX_MANIFEST_BYTES).toBe(64 * 1024);
    expect(PILOT_MAX_DECODE_CHANNELS).toBe(5);
    expect(PILOT_SHARP_LIMITS).toEqual({
      failOn: 'warning',
      limitInputChannels: 5,
      limitInputPixels: 40_000_000,
      unlimited: false,
    });
    expect(PILOT_TIERS).toEqual({
      hero: [384, 768, 1280],
      logo: [96, 192, 384],
      product: [384, 768, 1280],
    });
    expect(PILOT_SHA256_PATTERN.test('a'.repeat(64))).toBe(true);
    expect(PILOT_TIER_PATH_PATTERN.test(`${'a'.repeat(64)}.avif`)).toBe(true);
    expect(
      PILOT_UUID_PATTERN.test('6b5cb8a4-5575-456c-b936-8cdfae30db74')
    ).toBe(true);
  });
});
