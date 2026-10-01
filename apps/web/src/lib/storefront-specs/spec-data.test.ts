import { describe, expect, it } from 'vitest';
import { buildProductSpecData } from './spec-data';

describe('buildProductSpecData', () => {
  it('builds detailed grouped specs from product_key_specs', () => {
    const result = buildProductSpecData({
      brand: 'Samsung',
      category: 'Smartphones',
      condition: 'new',
      product_key_specs: {
        display_type: 'Dynamic AMOLED 2X',
        screen_size_inches: 6.8,
        refresh_rate_hz: 120,
        chipset: 'Snapdragon 8 Elite',
        ram_gb: 12,
        storage_gb: 256,
        main_camera_mp: 200,
        battery_mah: 5000,
        charging_watt: 45,
        has_5g: true,
      },
    });

    expect(result.detailedSpecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'Display' }),
        expect.objectContaining({ category: 'Platform' }),
        expect.objectContaining({ category: 'Memory' }),
        expect.objectContaining({ category: 'Battery' }),
      ])
    );
    expect(result.specs).toEqual(
      expect.arrayContaining([
        { label: 'Display', value: '6.8 inches' },
        { label: 'Processor', value: 'Snapdragon 8 Elite' },
        { label: 'RAM', value: '12GB' },
        { label: 'Storage', value: '256GB' },
        { label: 'Camera', value: '200MP' },
        { label: 'Battery', value: '5000mAh' },
      ])
    );
  });

  it('falls back to variant attributes without component imports', () => {
    const result = buildProductSpecData({
      brand: 'Apple',
      category: 'Smartphones',
      variant_attributes: [
        { param: 'Storage', options: ['256GB'] },
        { param: 'RAM', options: ['8GB'] },
      ],
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'General',
        items: expect.arrayContaining([
          { label: 'Brand', value: 'Apple' },
          { label: 'Storage', value: '256GB' },
          { label: 'RAM', value: '8GB' },
        ]),
      },
    ]);
  });

  it('safely ignores malformed HTML description tables without throwing', () => {
    const result = buildProductSpecData({
      brand: 'Tecno',
      category: 'Smartphones',
      description:
        '<h2>Key Specs</h2><table><tr><td>Display<td>6.8 inches</tr>',
      product_key_specs: {
        chipset: 'Helio G99',
      },
    });

    expect(result.detailedSpecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'Platform',
          items: [{ label: 'Chipset', value: 'Helio G99' }],
        }),
      ])
    );
  });

  it('omits null, undefined, and empty-string product key specs without throwing', () => {
    const result = buildProductSpecData({
      category: 'Smartphones',
      product_key_specs: {
        display_type: '   ',
        chipset: 'Snapdragon 8 Elite',
        gpu: '',
        ram_gb: null,
        storage_gb: undefined,
      },
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'Platform',
        items: [{ label: 'Chipset', value: 'Snapdragon 8 Elite' }],
      },
    ]);
    expect(
      result.detailedSpecs.flatMap((section) => section.items)
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: '' }),
        expect.objectContaining({ value: '   ' }),
        expect.objectContaining({ value: 'undefined' }),
        expect.objectContaining({ value: 'null' }),
      ])
    );
  });

  it('omits zero-valued numeric measurement placeholders', () => {
    const result = buildProductSpecData({
      category: 'Smartphones',
      product_key_specs: {
        ram_gb: 0,
        storage_gb: 0,
        battery_mah: 0,
      },
    });

    const values = result.detailedSpecs.flatMap((section) =>
      section.items.map((item) => item.value)
    );

    expect(values).not.toContain('0GB');
    expect(values).not.toContain('0mAh');
    expect(result.specs).toEqual([]);
  });

  it('handles empty variant attributes with a safe General fallback', () => {
    const result = buildProductSpecData({
      category: 'Smartphones',
      variant_attributes: [],
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'General',
        items: [
          { label: 'Brand', value: 'Generic' },
          { label: 'Condition', value: 'New' },
          { label: 'Category', value: 'Smartphones' },
        ],
      },
    ]);
  });

  it('normalizes malformed stored specification sections before rendering PDP specs', () => {
    const result = buildProductSpecData({
      detailedSpecs: [
        {
          category: undefined,
          items: [
            { label: ' Face value ', value: ' ₦30 gift card ' },
            { label: '', value: 'ignored' },
            { label: 'Numeric value', value: 30 },
          ],
        },
      ] as unknown as Parameters<
        typeof buildProductSpecData
      >[0]['detailedSpecs'],
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'General',
        items: [
          { label: 'Face value', value: '₦30 gift card' },
          { label: 'Numeric value', value: '30' },
        ],
      },
    ]);
  });

  it('retains same-label facts from distinct sections while stored facts win within each section', () => {
    const result = buildProductSpecData({
      category: 'Smartphones',
      detailedSpecs: [
        {
          category: 'Display',
          items: [{ label: 'Protection', value: 'Gorilla Glass Victus 2' }],
        },
        {
          category: 'Body',
          items: [{ label: 'Protection', value: 'IP68' }],
        },
      ],
      product_key_specs: {
        display_protection: 'Ceramic Shield',
        ip_rating: 'IP69',
      },
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'Display',
        items: [{ label: 'Protection', value: 'Gorilla Glass Victus 2' }],
      },
      {
        category: 'Body',
        items: [{ label: 'Protection', value: 'IP68' }],
      },
    ]);
  });

  it('uses the mobile taxonomy for a slug-only google-pixel PDP category', () => {
    const result = buildProductSpecData({
      categories: { slug: 'google-pixel' },
      product_key_specs: { has_5g: true, ram_gb: 12 },
    });

    expect(result.detailedSpecs).toEqual(
      expect.arrayContaining([
        {
          category: 'Network',
          items: [{ label: '5G Support', value: 'Yes' }],
        },
        {
          category: 'Memory',
          items: [{ label: 'RAM', value: '12GB' }],
        },
      ])
    );
  });

  it('keeps a mobile negative card-slot capability after normalization', () => {
    const result = buildProductSpecData({
      category: 'Smartphones',
      specifications: [
        {
          category: 'Memory',
          items: [{ label: 'Card Slot', value: 'No' }],
        },
      ],
      specs: [{ label: 'Card Slot', value: 'No' }],
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'Memory',
        items: [{ label: 'Card Slot', value: 'No' }],
      },
    ]);
    expect(result.specs).toEqual([{ label: 'Card Slot', value: 'No' }]);
  });
});
