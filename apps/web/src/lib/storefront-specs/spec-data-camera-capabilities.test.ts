import { describe, expect, it } from 'vitest';
import { buildProductSpecData } from './spec-data';

describe('buildProductSpecData camera capabilities', () => {
  it('shows verified OIS and NFC while suppressing false or placeholder evidence', () => {
    const verified = buildProductSpecData({
      category: 'Action Cameras',
      product_key_specs: { has_ois: true, has_nfc: true },
    });
    const unsupported = buildProductSpecData({
      category: 'Action Cameras',
      product_key_specs: { has_ois: 'Unknown', has_nfc: 'Not specified' },
    });

    expect(verified.detailedSpecs.flatMap((section) => section.items)).toEqual(
      expect.arrayContaining([
        { label: 'OIS', value: 'Yes' },
        { label: 'NFC', value: 'Yes' },
      ])
    );
    const unsupportedItems = unsupported.detailedSpecs.flatMap(
      (section) => section.items
    );
    for (const label of ['OIS', 'NFC']) {
      expect(unsupportedItems).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ label })])
      );
    }
  });

  it('rejects taxonomy-generated Radio legacy rows for cameras', () => {
    const result = buildProductSpecData({
      category: 'Action Cameras',
      specifications: [
        {
          category: 'Connectivity',
          items: [{ label: 'Radio', value: 'FM Radio' }],
        },
      ],
    });

    expect(result.detailedSpecs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ label: 'Radio' }),
          ]),
        }),
      ])
    );
  });
});
