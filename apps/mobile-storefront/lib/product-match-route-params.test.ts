import type { RefinedSearchRow } from '@baci/shared/lib';
import { buildSearchMatchRouteParams } from './product-match-route-params';

const baseMatch: RefinedSearchRow = {
  condition: 'Used',
  offerId: undefined,
  price: 100,
  productId: 'p1',
  total: 1,
  variantId: undefined,
};

describe('buildSearchMatchRouteParams', () => {
  it('forwards exact option ids without the snapshot condition', () => {
    expect(
      buildSearchMatchRouteParams({ ...baseMatch, offerId: 'offer-1' })
    ).toEqual({ offer_id: 'offer-1' });
    expect(
      buildSearchMatchRouteParams({ ...baseMatch, variantId: 'variant-1' })
    ).toEqual({ variant_id: 'variant-1' });
  });

  it('marks ID-less base matches so the PDP keeps the base price', () => {
    expect(buildSearchMatchRouteParams(baseMatch)).toEqual({
      condition: 'Used',
      match_base: '1',
    });
  });

  it('returns no params without a match', () => {
    expect(buildSearchMatchRouteParams(undefined)).toEqual({});
    expect(buildSearchMatchRouteParams(null)).toEqual({});
  });
});
