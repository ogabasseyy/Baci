import { expect, it } from 'vitest';
import { buildComparisonRows } from './product-comparison';

it('keeps absent and blank facts unknown without inventing specifications', () => {
  expect(
    buildComparisonRows([
      { id: '1', specifications: { RAM: '8 GB', Camera: '' } },
      { id: '2', specifications: { Storage: '128 GB' } },
    ])
  ).toEqual([
    { label: 'RAM', values: ['8 GB', null] },
    { label: 'Camera', values: [null, null] },
    { label: 'Storage', values: [null, '128 GB'] },
  ]);
});
