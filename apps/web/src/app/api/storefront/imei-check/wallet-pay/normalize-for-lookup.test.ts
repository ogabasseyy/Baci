import { normalizeDeviceIdentifier } from '@baci/shared/imei';
import { describe, expect, it } from 'vitest';
import { normalizeForLookup } from './normalize-for-lookup';

describe('normalizeForLookup', () => {
  it('normalises an IMEI exactly as the creation path does', () => {
    expect(
      normalizeForLookup('356938035643809', {
        tier: 'simLock',
        device_category: 'smartphone',
      })
    ).toBe(normalizeDeviceIdentifier('356938035643809', 'imei'));
  });

  it('case-folds an Apple serial for a serial tier, like the creation path', () => {
    expect(
      normalizeForLookup('c02xl0abjgh5', {
        tier: 'macIcloud',
        device_category: null,
      })
    ).toBe(normalizeDeviceIdentifier('c02xl0abjgh5', 'serial'));
  });
});
