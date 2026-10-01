import { describe, expect, it } from 'vitest';
import { buildProductSpecData } from './spec-data';

describe('buildProductSpecData computer capabilities', () => {
  it('keeps verified cellular laptop facts and an explicit missing headphone jack', () => {
    const result = buildProductSpecData({
      category: 'Laptops',
      product_key_specs: {
        has_5g: true,
        sim_type: 'eSIM',
        has_nfc: true,
        has_headphone_jack: false,
      },
    });
    const items = result.detailedSpecs.flatMap((section) => section.items);

    expect(items).toEqual(
      expect.arrayContaining([
        { label: '5G Support', value: 'Yes' },
        { label: 'SIM', value: 'eSIM' },
        { label: 'NFC', value: 'Yes' },
        { label: '3.5mm Jack', value: 'No' },
      ])
    );
  });

  it('does not turn an unknown NFC string into a positive laptop capability', () => {
    const result = buildProductSpecData({
      category: 'Laptops',
      product_key_specs: { has_nfc: 'Unknown' },
    });

    expect(
      result.detailedSpecs.flatMap((section) => section.items)
    ).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'NFC' })])
    );
  });
});
