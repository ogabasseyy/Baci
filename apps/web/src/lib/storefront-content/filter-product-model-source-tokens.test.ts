import { describe, expect, it } from 'vitest';
import { filterProductModelSourceTokens } from './filter-product-model-source-tokens';

describe('filterProductModelSourceTokens', () => {
  it('retains a trailing all-in-one printer form factor through category filtering', () => {
    const tokens = filterProductModelSourceTokens(
      ['smart', 'tank', '750', 'all', 'in', 'one', 'printer'],
      new Set(['printer', 'in'])
    );

    expect(tokens).toEqual([
      'smart',
      'tank',
      '750',
      'all',
      'in',
      'one',
      'printer',
    ]);
  });
});
