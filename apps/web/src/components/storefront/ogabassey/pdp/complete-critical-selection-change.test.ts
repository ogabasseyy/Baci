import { expect, it } from 'vitest';
import { completeCriticalSelectionChange } from './complete-critical-selection-change';

it('leaves choices unchanged when the product has no variants', () => {
  expect(
    completeCriticalSelectionChange(
      { price: 100, manage_stock: false, variants: [] },
      { storage: '1TB' },
      'storage',
      [],
      ['storage'],
      {}
    )
  ).toEqual({ storage: '1TB' });
});
