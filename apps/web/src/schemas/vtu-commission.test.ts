import { describe, expect, it } from 'vitest';
import { COMMISSION_CATEGORY_MAP } from './vtu-commission';

describe('COMMISSION_CATEGORY_MAP', () => {
  it('has all 5 bill type keys', () => {
    const expectedKeys = [
      'airtime',
      'data',
      'electricity',
      'cable_tv',
      'betting',
    ];
    const actualKeys = Object.keys(COMMISSION_CATEGORY_MAP);

    expect(actualKeys).toHaveLength(5);
    for (const key of expectedKeys) {
      expect(actualKeys).toContain(key);
    }
  });

  it('maps airtime to AIRTIME', () => {
    expect(COMMISSION_CATEGORY_MAP.airtime).toBe('AIRTIME');
  });

  it('maps data to DATA', () => {
    expect(COMMISSION_CATEGORY_MAP.data).toBe('DATA');
  });

  it('maps electricity to ELECTRICITY', () => {
    expect(COMMISSION_CATEGORY_MAP.electricity).toBe('ELECTRICITY');
  });

  it('maps cable_tv to CABLE', () => {
    expect(COMMISSION_CATEGORY_MAP.cable_tv).toBe('CABLE');
  });

  it('maps betting to BETTING', () => {
    expect(COMMISSION_CATEGORY_MAP.betting).toBe('BETTING');
  });

  it('returns uppercase commission categories', () => {
    const values = Object.values(COMMISSION_CATEGORY_MAP);
    for (const value of values) {
      expect(value).toBe(value.toUpperCase());
    }
  });
});
