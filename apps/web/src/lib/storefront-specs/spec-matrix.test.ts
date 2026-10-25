import { describe, expect, it } from 'vitest';
import { buildProductComparisonMatrix } from './spec-matrix';

describe('buildProductComparisonMatrix', () => {
  it('builds grouped comparison rows from detailed specs for two products', () => {
    const matrix = buildProductComparisonMatrix({
      products: [
        {
          id: 'left',
          name: 'Phone A',
          category: 'Smartphones',
          product_key_specs: {
            screen_size_inches: 6.7,
            refresh_rate_hz: 120,
            chipset: 'Chip A',
            ram_gb: 8,
            battery_mah: 5000,
          },
        },
        {
          id: 'right',
          name: 'Phone B',
          category: 'Smartphones',
          product_key_specs: {
            screen_size_inches: 6.8,
            refresh_rate_hz: 144,
            chipset: 'Chip B',
            ram_gb: 12,
            battery_mah: 5500,
          },
        },
      ],
    });

    expect(matrix.columns).toEqual([
      { productId: 'left', label: 'Phone A' },
      { productId: 'right', label: 'Phone B' },
    ]);
    expect(matrix.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'Display',
          rows: expect.arrayContaining([
            {
              label: 'Size',
              values: ['6.7 inches', '6.8 inches'],
              isDifferent: true,
            },
          ]),
        }),
      ])
    );
    expect(matrix.differentiatingRowCount).toBeGreaterThanOrEqual(3);
  });

  it('uses em dash for missing values and keeps available counterpart values', () => {
    const matrix = buildProductComparisonMatrix({
      products: [
        {
          id: 'left',
          name: 'Phone A',
          category: 'Smartphones',
          product_key_specs: { ram_gb: 8 },
        },
        {
          id: 'right',
          name: 'Phone B',
          category: 'Smartphones',
          product_key_specs: { storage_gb: 256 },
        },
      ],
    });

    const memoryGroup = matrix.groups.find(
      (group) => group.category === 'Memory'
    );
    expect(memoryGroup?.rows).toEqual(
      expect.arrayContaining([
        { label: 'RAM', values: ['8GB', 'Not documented'], isDifferent: false },
        {
          label: 'Storage',
          values: ['Not documented', '256GB'],
          isDifferent: false,
        },
      ])
    );
  });

  it('uses mobile rows for slug-only google-pixel comparison categories', () => {
    const matrix = buildProductComparisonMatrix({
      products: [
        {
          id: 'pixel',
          name: 'Google Pixel 10',
          category: 'google_pixel',
          product_key_specs: { has_5g: true, ram_gb: 12 },
        },
      ],
    });

    expect(matrix.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'Network',
          rows: [{ label: '5G Support', values: ['Yes'], isDifferent: false }],
        }),
      ])
    );
  });
});

describe('comparison semantics', () => {
  it('coalesces case and punctuation aliases, without treating missing facts as differences', () => {
    const matrix = buildProductComparisonMatrix({
      products: [
        {
          id: 'a',
          name: 'Laptop A',
          category: 'Laptops',
          specifications: [
            {
              category: 'Performance',
              items: [
                { label: 'CPU / GPU', value: 'M2 Max' },
                { label: 'SSD storage', value: '1TB' },
                { label: 'Refresh rate', value: '120Hz' },
              ],
            },
          ],
        },
        {
          id: 'b',
          name: 'Laptop B',
          category: 'Laptops',
          specifications: [
            {
              category: 'Performance',
              items: [
                { label: 'CPU/GPU', value: 'M3 Max' },
                { label: 'Storage', value: '1TB' },
                { label: 'Refresh Rate', value: '120 Hz' },
                { label: 'Battery runtime', value: '18 hours' },
              ],
            },
          ],
        },
      ],
    });
    expect(matrix.flatRows.filter((row) => /CPU/.test(row.label))).toHaveLength(
      1
    );
    expect(
      matrix.flatRows.filter((row) => /storage/i.test(row.label))
    ).toHaveLength(1);
    expect(
      matrix.flatRows.find((row) => /refresh/i.test(row.label))?.isDifferent
    ).toBe(false);
    expect(
      matrix.flatRows.find((row) => row.label === 'Battery runtime')
    ).toMatchObject({
      values: ['Not documented', '18 hours'],
      isDifferent: false,
    });
  });
});

it('joins durability aliases across groups and flags conflicting catalog values without declaring an advantage', () => {
  const matrix = buildProductComparisonMatrix({
    products: [
      {
        id: 'a',
        name: 'Phone A',
        category: 'Smartphones',
        specifications: [
          { category: 'Body', items: [{ label: 'Durability', value: 'IP68' }] },
          {
            category: 'Screen',
            items: [{ label: 'Refresh rate', value: '60Hz' }],
          },
          {
            category: 'Display',
            items: [{ label: 'Refresh Rate', value: '120Hz' }],
          },
        ],
      },
      {
        id: 'b',
        name: 'Phone B',
        category: 'Smartphones',
        specifications: [
          {
            category: 'Battery and connectivity',
            items: [{ label: 'IP rating', value: 'IP68' }],
          },
        ],
      },
    ],
  });
  expect(
    matrix.flatRows.filter((row) => row.label === 'Water and dust resistance')
  ).toEqual([
    {
      label: 'Water and dust resistance',
      values: ['IP68', 'IP68'],
      isDifferent: false,
    },
  ]);
  expect(
    matrix.flatRows.find((row) => row.label === 'Refresh Rate')
  ).toMatchObject({
    values: [
      expect.stringContaining('Conflicting catalog values'),
      'Not documented',
    ],
    isDifferent: false,
  });
});

it('collects three distinct conflicting values once and ignores repeated values after a conflict', () => {
  const matrix = buildProductComparisonMatrix({
    products: [
      {
        id: 'one',
        name: 'Laptop',
        category: 'Laptops',
        specifications: [
          {
            category: 'Storage A',
            items: [{ label: 'SSD storage', value: '256GB' }],
          },
          {
            category: 'Storage B',
            items: [{ label: 'Storage', value: '512GB' }],
          },
          {
            category: 'Storage C',
            items: [{ label: 'Internal storage', value: '1TB' }],
          },
          {
            category: 'Storage D',
            items: [{ label: 'Storage', value: '512 GB' }],
          },
          {
            category: 'Storage E',
            items: [{ label: 'Storage', value: '256GB' }],
          },
        ],
      },
    ],
  });
  expect(
    matrix.flatRows.find((row) => row.label === 'Storage')?.values
  ).toEqual(['Conflicting catalog values (verify): 256GB; 512GB; 1TB']);
});

it('does not manufacture a conflict for semantically duplicate alias values', () => {
  const matrix = buildProductComparisonMatrix({
    products: [
      {
        id: 'one',
        name: 'Laptop',
        category: 'Laptops',
        specifications: [
          {
            category: 'Memory',
            items: [{ label: 'SSD storage', value: '512GB' }],
          },
          {
            category: 'Storage',
            items: [{ label: 'Storage', value: '512 GB' }],
          },
          {
            category: 'Configuration',
            items: [{ label: 'Internal storage', value: '512GB' }],
          },
        ],
      },
    ],
  });
  expect(
    matrix.flatRows.find((row) => row.label === 'Storage')?.values
  ).toEqual(['512GB']);
});
