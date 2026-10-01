import { describe, expect, it } from 'vitest';
import { buildProductSpecData } from './spec-data';

describe('buildProductSpecData general families', () => {
  it('does not turn generic accessory key specs into phone specifications', () => {
    const result = buildProductSpecData({
      category: 'Accessories',
      product_key_specs: {
        chipset: 'Apple U1',
        battery_mah: 0,
        has_5g: false,
        has_nfc: true,
      },
    });

    expect(result.detailedSpecs.map((section) => section.category)).toEqual([
      'General',
    ]);
    expect(
      result.detailedSpecs.flatMap((section) => section.items)
    ).not.toEqual(
      expect.arrayContaining([
        { label: '5G Support', value: 'No' },
        { label: 'Battery Capacity', value: '0mAh' },
        { label: 'Chipset', value: 'Apple U1' },
      ])
    );
  });

  it('filters stale phone rows from legacy specifications on accessory PDPs', () => {
    const result = buildProductSpecData({
      category: 'Phone Accessories',
      specifications: [
        {
          category: 'Stored Details',
          items: [
            { label: '5G Support', value: 'No' },
            { label: 'SIM', value: 'Nano-SIM' },
            { label: 'Material', value: 'Silicone' },
          ],
        },
      ],
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'Stored Details',
        items: [{ label: 'Material', value: 'Silicone' }],
      },
    ]);
  });

  it('retains positive audio rows for general product PDPs', () => {
    const result = buildProductSpecData({
      category: 'Audio',
      specifications: [
        {
          category: 'Sound',
          items: [
            { label: 'Speakers', value: 'Stereo' },
            { label: 'Headphone Jack', value: 'Yes' },
            { label: '5G Support', value: 'No' },
          ],
        },
      ],
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'Sound',
        items: [
          { label: 'Speakers', value: 'Stereo' },
          { label: 'Headphone Jack', value: 'Yes' },
        ],
      },
    ]);
  });

  it('retains positive audio key specs for general product PDPs', () => {
    const result = buildProductSpecData({
      category: 'Audio',
      product_key_specs: {
        has_stereo_speakers: true,
        has_headphone_jack: true,
      },
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'Sound',
        items: [
          { label: 'Loudspeaker', value: 'Yes, with stereo speakers' },
          { label: '3.5mm Jack', value: 'Yes' },
        ],
      },
    ]);
  });

  it('uses the trimmed legacy category when a joined category name is blank', () => {
    const result = buildProductSpecData({
      category: ' Smartphones ',
      categories: { name: '   ', slug: 'smartphones' },
      product_key_specs: { ram_gb: 8, storage_gb: 256 },
    });

    expect(result.detailedSpecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'Memory',
          items: expect.arrayContaining([
            { label: 'RAM', value: '8GB' },
            { label: 'Internal Storage', value: '256GB' },
          ]),
        }),
      ])
    );
  });
  it('retains safe key specs for general gaming products', () => {
    const result = buildProductSpecData({
      category: 'Gaming',
      product_key_specs: {
        chipset: 'Custom AMD Zen 2',
        gpu: 'RDNA 2',
        storage_gb: 825,
        has_5g: false,
      },
    });

    expect(result.detailedSpecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'Processing',
          items: [
            { label: 'Processor', value: 'Custom AMD Zen 2' },
            { label: 'GPU', value: 'RDNA 2' },
          ],
        }),
        expect.objectContaining({
          category: 'Memory',
          items: [{ label: 'Internal Storage', value: '825GB' }],
        }),
      ])
    );
    expect(
      result.detailedSpecs.flatMap((section) => section.items)
    ).not.toEqual(
      expect.arrayContaining([{ label: '5G Support', value: 'No' }])
    );
  });

  it('rejects unsupported fallback values while retaining verified general facts', () => {
    const placeholders = buildProductSpecData({
      displaySize: ' ',
      ram: '0GB',
      storage: ['0mAh', 'No', 'unknown'],
      variant_attributes: [{ param: 'SIM Type', options: ['No'] }],
    });
    const verified = buildProductSpecData({
      category: 'Gaming',
      displaySize: '6.7 inches',
      ram: '8GB',
      variant_attributes: [
        { param: 'Storage', options: ['0mAh', '256GB'] },
        { param: 'SIM Type', options: ['Nano-SIM'] },
      ],
    });

    expect(placeholders.detailedSpecs).toEqual([
      {
        category: 'General',
        items: [
          { label: 'Brand', value: 'Generic' },
          { label: 'Condition', value: 'New' },
          { label: 'Category', value: 'General' },
        ],
      },
    ]);
    expect(verified.detailedSpecs).toEqual([
      {
        category: 'General',
        items: [
          { label: 'Brand', value: 'Generic' },
          { label: 'Condition', value: 'New' },
          { label: 'Category', value: 'Gaming' },
          { label: 'Display', value: '6.7 inches' },
          { label: 'RAM', value: '8GB' },
          { label: 'Storage', value: '256GB' },
        ],
      },
    ]);
  });

  it('keeps stored rows ahead of description and key-spec fallback rows', () => {
    const result = buildProductSpecData({
      category: 'Gaming',
      description:
        '<h2>Key Specs</h2><table><tr><th>ram</th><td>16GB</td></tr></table>',
      specifications: [
        {
          category: 'Memory',
          items: [
            { label: 'RAM', value: '8GB' },
            { label: 'ram', value: '12GB' },
            { label: 'Internal Storage', value: '256GB' },
          ],
        },
      ],
      product_key_specs: { ram_gb: 32, storage_gb: 512 },
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'Memory',
        items: [
          { label: 'RAM', value: '8GB' },
          { label: 'Internal Storage', value: '256GB' },
        ],
      },
    ]);
    expect(result.specs).toEqual([
      { label: 'RAM', value: '8GB' },
      { label: 'Storage', value: '256GB' },
    ]);
  });

  it('filters unsupported negative card-slot rows for general and accessory PDPs', () => {
    for (const category of ['Gaming', 'Phone Accessories']) {
      const result = buildProductSpecData({
        category,
        specifications: [
          {
            category: 'Details',
            items: [{ label: 'Card Slot', value: 'No' }],
          },
        ],
        specs: [{ label: 'Card Slot', value: 'No' }],
      });

      expect(result.detailedSpecs).toEqual([
        {
          category: 'General',
          items: [
            { label: 'Brand', value: 'Generic' },
            { label: 'Condition', value: 'New' },
            { label: 'Category', value: category },
          ],
        },
      ]);
      expect(result.specs).toEqual([]);
    }
  });
  it('treats placeholder category names as unknown rather than projecting stale device specs', () => {
    const result = buildProductSpecData({
      category: 'Unknown',
      product_key_specs: { ram_gb: 8, storage_gb: 256 },
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'General',
        items: [
          { label: 'Brand', value: 'Generic' },
          { label: 'Condition', value: 'New' },
          { label: 'Category', value: 'General' },
        ],
      },
    ]);
  });
});
