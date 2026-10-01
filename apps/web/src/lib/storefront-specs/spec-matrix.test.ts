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
        { label: 'RAM', values: ['8GB', '—'], isDifferent: true },
        {
          label: 'Internal Storage',
          values: ['—', '256GB'],
          isDifferent: true,
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
