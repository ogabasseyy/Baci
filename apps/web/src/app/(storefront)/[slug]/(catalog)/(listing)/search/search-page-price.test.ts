import { describe, expect, it } from 'vitest';
import { getPriceFormatter } from './search-page-price';

describe('getPriceFormatter', () => {
  it('formats whole-unit NGN prices', () => {
    expect(getPriceFormatter('NGN').format(1200000)).toBe('₦1,200,000');
  });

  it('reuses the cached formatter per currency', () => {
    expect(getPriceFormatter('NGN')).toBe(getPriceFormatter('NGN'));
  });
});
