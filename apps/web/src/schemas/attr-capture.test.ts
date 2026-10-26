import { describe, expect, it } from 'vitest';
import { CLICK_ID_PARAMS } from '@/lib/ad-tracking-cookies';
import {
  ATTR_CAPTURE_PARAM_KEYS,
  attrCaptureSchema,
} from '@/schemas/attr-capture';

describe('attrCaptureSchema', () => {
  it('accepts a single known click ID', () => {
    const result = attrCaptureSchema.safeParse({ gclid: 'Cj0KCQjw_abc-123' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ gclid: 'Cj0KCQjw_abc-123' });
    }
  });

  it('accepts every known click-ID param together', () => {
    const result = attrCaptureSchema.safeParse({
      fbclid: 'IwAR0abc',
      ttclid: 'ttclid.value_1',
      gclid: 'gclid-value',
      sccid: 'sccid~value',
      marketing_consent: 'true',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a payload with no click IDs', () => {
    const result = attrCaptureSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('rejects unknown params (strict object)', () => {
    const result = attrCaptureSchema.safeParse({
      gclid: 'valid',
      utm_source: 'google',
    });

    expect(result.success).toBe(false);
  });

  it('rejects values over the 256-char cap', () => {
    const result = attrCaptureSchema.safeParse({ gclid: 'a'.repeat(257) });

    expect(result.success).toBe(false);
  });

  it('rejects values with non-URL-safe characters', () => {
    for (const value of [
      'has space',
      'has<angle',
      'has=equals',
      'has/slash',
      'inject\r\nheader',
      'semi;colon',
    ]) {
      expect(attrCaptureSchema.safeParse({ gclid: value }).success).toBe(false);
    }
  });

  it('rejects an empty string value', () => {
    expect(attrCaptureSchema.safeParse({ gclid: '' }).success).toBe(false);
  });

  it('stays in lockstep with CLICK_ID_PARAMS (drift guard)', () => {
    expect([...ATTR_CAPTURE_PARAM_KEYS].sort()).toEqual(
      Object.keys(CLICK_ID_PARAMS).sort()
    );
  });
});
