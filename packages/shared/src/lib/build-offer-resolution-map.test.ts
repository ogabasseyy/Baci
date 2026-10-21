import { describe, expect, it } from 'vitest';
import { buildOfferResolutionMap } from './build-offer-resolution-map';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '22222222-2222-4222-8222-222222222222';

describe('buildOfferResolutionMap', () => {
  it('keys rows by product and offer', () => {
    const map = buildOfferResolutionMap([
      { product_id: PRODUCT_ID, offer_id: OFFER_ID, price_basis: 80 },
      null,
    ]);
    expect(map.get(`${PRODUCT_ID}::${OFFER_ID}`)?.priceBasis).toBe(80);
    expect(map.size).toBe(1);
  });

  it('returns an empty map for non-arrays', () => {
    expect(buildOfferResolutionMap(null).size).toBe(0);
  });
});
