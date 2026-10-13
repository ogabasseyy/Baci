import { describe, expect, it } from 'vitest';
import { normalizeVariantDiscriminatorTokens } from './normalize-variant-discriminator-tokens';

describe('normalizeVariantDiscriminatorTokens', () => {
  it('joins split capacity units and hyphenated Wi-Fi tokens', () => {
    const tokens = normalizeVariantDiscriminatorTokens([
      'ipad',
      '128',
      'gb',
      'wi',
      'fi',
    ]);

    expect(tokens).toEqual(['ipad', '128gb', 'wifi']);
  });

  it('canonicalizes a hyphenated e-SIM marker', () => {
    const tokens = normalizeVariantDiscriminatorTokens([
      'iphone',
      '15',
      'e',
      'sim',
    ]);

    expect(tokens).toEqual(['iphone', '15', 'esim']);
  });

  it('joins a split decimal display dimension into one discriminator', () => {
    const tokens = normalizeVariantDiscriminatorTokens([
      'ipad',
      '12',
      '9',
      'inch',
    ]);

    expect(tokens).toEqual(['ipad', '12.9inch']);
  });

  it('normalizes a known terminal bare storage capacity', () => {
    const tokens = normalizeVariantDiscriminatorTokens([
      'samsung',
      'galaxy',
      's25',
      '256',
    ]);

    expect(tokens).toEqual(['samsung', 'galaxy', 's25', '256gb']);
  });

  it('canonicalizes equivalent GB and TB storage capacities', () => {
    expect(normalizeVariantDiscriminatorTokens(['1024gb', '2', 'tb'])).toEqual([
      '1tb',
      '2tb',
    ]);
  });

  it('canonicalizes a bare terabyte-equivalent terminal capacity', () => {
    const tokens = normalizeVariantDiscriminatorTokens([
      's25',
      'ultra',
      '1024',
    ]);

    expect(tokens).toEqual(['s25', 'ultra', '1tb']);
  });

  it('joins separated battery, wattage, voltage, and refresh-rate units', () => {
    expect(
      normalizeVariantDiscriminatorTokens([
        '10000',
        'mah',
        '20',
        'w',
        '110',
        'v',
        '144',
        'hz',
      ])
    ).toEqual(['10000mah', '20w', '110v', '144hz']);
  });

  it('canonicalizes active noise cancellation', () => {
    expect(
      normalizeVariantDiscriminatorTokens(['active', 'noise', 'cancellation'])
    ).toEqual(['anc']);
  });

  it('canonicalizes multi-token laptop hardware tiers', () => {
    expect(
      normalizeVariantDiscriminatorTokens(['core', 'ultra', '7', 'rtx', '4060'])
    ).toEqual(['coreultra7', 'rtx4060']);
  });
});
