import { describe, expect, it } from '@jest/globals';
import { IMEI_CARE } from './imei-care-palette';

describe('IMEI_CARE', () => {
  it('keeps the hero burgundy with white text', () => {
    expect(IMEI_CARE.hero).toBe('#351521');
    expect(IMEI_CARE.heroText).toBe('#ffffff');
  });
});
