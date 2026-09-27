import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildProductSpecData: vi.fn(),
}));

vi.mock('./spec-data', () => ({
  buildProductSpecData: mocks.buildProductSpecData,
}));

import { buildProductComparisonMatrix } from './spec-matrix';

describe('buildProductComparisonMatrix transformation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('preserves first duplicate values and fills missing product specs', () => {
    mocks.buildProductSpecData
      .mockReturnValueOnce({
        detailedSpecs: [
          {
            category: 'Memory',
            items: [
              { label: 'RAM', value: '8GB' },
              { label: 'RAM', value: 'ignored' },
            ],
          },
          {
            category: 'Memory',
            items: [{ label: 'Storage', value: 'ignored' }],
          },
        ],
      })
      .mockReturnValueOnce({
        detailedSpecs: [
          { category: 'Memory', items: [{ label: 'Storage', value: '256GB' }] },
        ],
      });

    const matrix = buildProductComparisonMatrix({
      products: [
        { id: 'left', name: 'Left' },
        { id: 'right', name: 'Right' },
      ],
    });

    expect(matrix.groups).toEqual([
      {
        category: 'Memory',
        rows: [
          { label: 'RAM', values: ['8GB', '—'], isDifferent: true },
          { label: 'Storage', values: ['—', '256GB'], isDifferent: true },
        ],
      },
    ]);
  });

  it('preserves ordered specification groups and difference counts', () => {
    const leftSections = [
      {
        category: 'Display',
        items: [
          { label: 'Size', value: '6.7 inches' },
          { label: 'Refresh Rate', value: '120Hz' },
        ],
      },
      {
        category: 'Memory',
        items: [{ label: 'RAM', value: '8GB' }],
      },
    ];
    const rightSections = [
      {
        category: 'Display',
        items: [
          { label: 'Size', value: '6.8 inches' },
          { label: 'Refresh Rate', value: '144Hz' },
        ],
      },
      {
        category: 'Memory',
        items: [{ label: 'RAM', value: '12GB' }],
      },
    ];
    mocks.buildProductSpecData
      .mockReturnValueOnce({ detailedSpecs: leftSections })
      .mockReturnValueOnce({ detailedSpecs: rightSections });

    const matrix = buildProductComparisonMatrix({
      products: [
        { id: 'left', name: 'Phone A' },
        { id: 'right', name: 'Phone B' },
      ],
    });

    expect(matrix).toEqual({
      columns: [
        { productId: 'left', label: 'Phone A' },
        { productId: 'right', label: 'Phone B' },
      ],
      groups: [
        {
          category: 'Display',
          rows: [
            {
              label: 'Size',
              values: ['6.7 inches', '6.8 inches'],
              isDifferent: true,
            },
            {
              label: 'Refresh Rate',
              values: ['120Hz', '144Hz'],
              isDifferent: true,
            },
          ],
        },
        {
          category: 'Memory',
          rows: [{ label: 'RAM', values: ['8GB', '12GB'], isDifferent: true }],
        },
      ],
      flatRows: [
        {
          label: 'Size',
          values: ['6.7 inches', '6.8 inches'],
          isDifferent: true,
        },
        {
          label: 'Refresh Rate',
          values: ['120Hz', '144Hz'],
          isDifferent: true,
        },
        { label: 'RAM', values: ['8GB', '12GB'], isDifferent: true },
      ],
      differentiatingRowCount: 3,
    });
  });
});
