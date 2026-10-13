import { describe, expect, it } from 'vitest';

import { buildProductSpecData } from './spec-data';

describe('buildProductSpecData camera card slots', () => {
  it('suppresses a camera card-slot type when the capability is explicitly false', () => {
    const result = buildProductSpecData({
      category: 'Cameras',
      product_key_specs: {
        card_slot_type: 'CFexpress Type B',
        has_card_slot: false,
      },
    });

    expect(
      result.detailedSpecs.flatMap((section) => section.items)
    ).not.toEqual(
      expect.arrayContaining([
        { label: 'Card Slot', value: 'CFexpress Type B' },
      ])
    );
  });

  it('suppresses legacy card-slot labels only when the stored capability is false', () => {
    const unavailable = buildProductSpecData({
      category: 'Cameras',
      detailedSpecs: [
        {
          category: 'Storage',
          items: [{ label: 'Card-Slot', value: 'CFexpress Type B' }],
        },
        {
          category: 'Media',
          items: [{ label: 'Memory Card Slot', value: 'UHS-II SD' }],
        },
      ],
      product_key_specs: { has_card_slot: false },
      specs: [{ label: 'Memory Card Slot', value: 'UHS-II SD' }],
    });
    const available = buildProductSpecData({
      category: 'Cameras',
      detailedSpecs: [
        {
          category: 'Storage',
          items: [{ label: 'Memory Card Slot', value: 'CFexpress Type B' }],
        },
      ],
      product_key_specs: { has_card_slot: true },
    });

    expect(
      unavailable.detailedSpecs.flatMap((section) => section.items)
    ).not.toContainEqual({ label: 'Card-Slot', value: 'CFexpress Type B' });
    expect(
      unavailable.detailedSpecs.flatMap((section) => section.items)
    ).not.toContainEqual({ label: 'Memory Card Slot', value: 'UHS-II SD' });
    expect(unavailable.specs).not.toContainEqual({
      label: 'Memory Card Slot',
      value: 'UHS-II SD',
    });
    expect(available.detailedSpecs).toEqual([
      {
        category: 'Storage',
        items: [{ label: 'Memory Card Slot', value: 'CFexpress Type B' }],
      },
    ]);
  });
});
