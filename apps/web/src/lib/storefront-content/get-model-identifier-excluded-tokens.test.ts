import { describe, expect, it } from 'vitest';
import { getExcludedModelIdentifierTokens } from './get-model-identifier-excluded-tokens';

describe('getExcludedModelIdentifierTokens', () => {
  it('excludes the configured brand from a matching model slug', () => {
    const excluded = getExcludedModelIdentifierTokens(
      {
        categorySlug: 'smartphones',
        brands: ['Samsung'],
        productSlugs: ['samsung-galaxy-s25'],
      },
      'samsung-galaxy-s25',
      new Set(['pc']),
      new Set(),
      (value) =>
        value
          .toLowerCase()
          .split(/[^a-z0-9]+/u)
          .filter(Boolean)
    );

    expect(excluded.has('samsung')).toBe(true);
    expect(excluded.has('pc')).toBe(true);
  });

  it('retains gaming laptop model family aliases (predator, nitro, aorus) when followed by model tokens', () => {
    const tokenize = (value: string) =>
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/u)
        .filter(Boolean);

    const predatorExcluded = getExcludedModelIdentifierTokens(
      {
        categorySlug: 'gaming-laptops',
        brands: ['Acer'],
        productSlugs: ['acer-predator-helios-16'],
      },
      'acer-predator-helios-16',
      new Set(),
      new Set(),
      tokenize
    );
    expect(predatorExcluded.has('predator')).toBe(false);

    const nitroExcluded = getExcludedModelIdentifierTokens(
      {
        categorySlug: 'gaming-laptops',
        brands: ['Acer'],
        productSlugs: ['acer-nitro-v-15'],
      },
      'acer-nitro-v-15',
      new Set(),
      new Set(),
      tokenize
    );
    expect(nitroExcluded.has('nitro')).toBe(false);

    const aorusExcluded = getExcludedModelIdentifierTokens(
      {
        categorySlug: 'gaming-laptops',
        brands: ['Gigabyte'],
        productSlugs: ['gigabyte-aorus-16x'],
      },
      'gigabyte-aorus-16x',
      new Set(),
      new Set(),
      tokenize
    );
    expect(aorusExcluded.has('aorus')).toBe(false);

    const bladeExcluded = getExcludedModelIdentifierTokens(
      {
        categorySlug: 'gaming-laptops',
        brands: ['Razer'],
        productSlugs: ['razer-blade-16'],
      },
      'razer-blade-16',
      new Set(),
      new Set(),
      tokenize
    );
    expect(bladeExcluded.has('blade')).toBe(false);
  });
});
