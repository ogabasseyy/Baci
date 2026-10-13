import { describe, expect, it } from 'vitest';
import { shouldSuppressAuthoritativeFalseLegacySpec } from './should-suppress-authoritative-false-legacy-spec';

describe('shouldSuppressAuthoritativeFalseLegacySpec', () => {
  it('does not suppress when canonical key or authoritative specs are absent', () => {
    expect(
      shouldSuppressAuthoritativeFalseLegacySpec(
        { category: 'Cameras', categories: null },
        { label: 'OIS', value: 'Yes' },
        undefined
      )
    ).toBe(false);
    expect(
      shouldSuppressAuthoritativeFalseLegacySpec(
        { category: 'Cameras', categories: null, product_key_specs: null },
        { key: 'has_ois', value: 'Yes' },
        'has_ois'
      )
    ).toBe(false);
  });

  it('suppresses stale legacy rows when authoritative capability is false', () => {
    const product = {
      category: 'Cameras',
      categories: null,
      product_key_specs: {
        has_ois: false,
        has_wireless_charging: false,
      },
    };

    expect(
      shouldSuppressAuthoritativeFalseLegacySpec(
        product,
        { label: 'OIS', value: 'Yes' },
        'has_ois'
      )
    ).toBe(true);
    expect(
      shouldSuppressAuthoritativeFalseLegacySpec(
        product,
        { label: 'Wireless Charging', value: '15W' },
        'wireless_charging_watt'
      )
    ).toBe(true);
  });

  it('preserves explicit false keyed capabilities on the authoritative row', () => {
    const product = {
      category: 'Smartphones',
      categories: null,
      product_key_specs: { has_5g: false },
    };

    for (const value of [false, 'false', 'No'] as const) {
      expect(
        shouldSuppressAuthoritativeFalseLegacySpec(
          product,
          { key: 'has_5g', value },
          'has_5g'
        )
      ).toBe(false);
    }
  });

  it('does not suppress unrelated specs when another authoritative capability is false', () => {
    expect(
      shouldSuppressAuthoritativeFalseLegacySpec(
        {
          category: 'Cameras',
          categories: null,
          product_key_specs: { has_ois: false },
        },
        { label: 'Weather Sealing', value: 'No' },
        'weather_sealing'
      )
    ).toBe(false);
  });
});
