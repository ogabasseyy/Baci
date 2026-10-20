import { describe, expect, it } from 'vitest';
import { protectedOfferFixture } from './piggyvest-protected-offer';

describe('protectedOfferFixture', () => {
  it('builds a schema-valid receipt bound to the purchase fixture', () => {
    const fixture = protectedOfferFixture();
    expect(fixture.receipt.priceKobo).toBe(97000);
    expect(fixture.receipt.scope).toBe('device_price_only');
    expect(fixture.receipt.goalId).toBe(fixture.source.policy.goalId);
    expect(fixture.published).toEqual({
      status: 'published',
      receipt: fixture.receipt,
    });
    expect(fixture.observation.receipt).toEqual(fixture.receipt);
    expect(fixture.observation.pricePromise).toBe('active');
  });
});
