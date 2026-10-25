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

  it('reports conflicting values, retains repeated-section facts and distinguishes missing specs', () => {
    mocks.buildProductSpecData
      .mockReturnValueOnce({
        detailedSpecs: [
          {
            category: 'Memory',
            items: [
              { label: 'RAM', value: '8GB' },
              { label: 'RAM', value: '16GB' },
            ],
          },
          {
            category: 'Memory',
            items: [{ label: 'Storage', value: '128GB' }],
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
          {
            label: 'RAM',
            values: [
              'Conflicting catalog values (verify): 8GB; 16GB',
              'Not documented',
            ],
            isDifferent: false,
          },
          { label: 'Storage', values: ['128GB', '256GB'], isDifferent: true },
        ],
      },
    ]);
    expect(matrix.differentiatingRowCount).toBe(1);
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

it('collects conflicts in repeated source sections without losing equivalent duplicates', () => {
  mocks.buildProductSpecData.mockReturnValueOnce({
    detailedSpecs: [
      { category: 'Memory', items: [{ label: 'RAM', value: '8GB' }] },
      { category: 'Memory', items: [{ label: 'RAM', value: '16GB' }] },
      { category: 'Memory', items: [{ label: 'RAM', value: '8 GB' }] },
      { category: 'Memory', items: [{ label: 'RAM', value: '32GB' }] },
    ],
  });
  const matrix = buildProductComparisonMatrix({
    products: [{ id: 'left', name: 'Left' }],
  });
  expect(matrix.flatRows).toEqual([
    {
      label: 'RAM',
      values: ['Conflicting catalog values (verify): 8GB; 16GB; 32GB'],
      isDifferent: false,
    },
  ]);
  expect(matrix.differentiatingRowCount).toBe(0);
});
