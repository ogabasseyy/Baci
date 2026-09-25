import { describe, expect, it } from 'vitest';
import { getJumiaOrderQueryFilters } from './order-query-filters';

describe('getJumiaOrderQueryFilters', () => {
  it('omits country and shop filters for the shared OAuth fallback shop', () => {
    expect(
      getJumiaOrderQueryFilters({
        shopId: 'oauth',
        countryCode: 'NG',
        marketplaceKey: 'oauth',
      })
    ).toEqual({});
  });

  it('filters OAuth shops by shop id only so other countries are not dropped', () => {
    expect(
      getJumiaOrderQueryFilters({
        shopId: 'shop-1',
        countryCode: 'NG',
        marketplaceKey: 'oauth',
      })
    ).toEqual({
      shopId: 'shop-1',
    });
  });

  it('passes ISO country codes for self-authorized integrations', () => {
    expect(
      getJumiaOrderQueryFilters({
        shopId: 'shop-1',
        countryCode: 'NG',
        marketplaceKey: 'NG-1',
      })
    ).toEqual({
      country: 'NG',
      shopId: 'shop-1',
    });
  });
});
