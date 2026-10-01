import { describe, expect, it } from 'vitest';
import { getLaptopHardwareDiscriminatorTokens } from './get-laptop-hardware-discriminator-tokens';

describe('getLaptopHardwareDiscriminatorTokens', () => {
  it('returns complete Core Ultra and RTX hardware tiers', () => {
    expect(
      getLaptopHardwareDiscriminatorTokens(
        ['dell', 'xps', '13', '9340', 'coreultra7'],
        'laptops'
      )
    ).toEqual(['coreultra7']);
    expect(
      getLaptopHardwareDiscriminatorTokens(
        ['asus', 'rog', 'g16', 'rtx4060'],
        'gaming-laptops'
      )
    ).toEqual(['rtx4060']);
  });

  it('returns every hardware tier from a combined laptop configuration', () => {
    expect(
      getLaptopHardwareDiscriminatorTokens(
        ['asus', 'rog', 'g16', 'corei7', 'rtx4060'],
        'gaming-laptops'
      )
    ).toEqual(['corei7', 'rtx4060']);
  });

  it('ignores hardware-looking tokens outside laptop categories', () => {
    expect(
      getLaptopHardwareDiscriminatorTokens(['rtx4060'], 'accessories')
    ).toEqual([]);
  });

  it('recognizes three-digit Intel processor suffixes', () => {
    expect(
      getLaptopHardwareDiscriminatorTokens(
        ['dell', 'inspiron', '7440', 'core7', '150u'],
        'laptops'
      )
    ).toEqual(['150u']);
  });
});
