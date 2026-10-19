import { describe, expect, it } from 'vitest';
import { cacheInvalidationDrainCronResponseSchemas } from './cache-invalidation-drain-cron';

const claim = {
  attempts: 1,
  claim_token: '11111111-1111-4111-8111-111111111111',
  generation: 2,
  merchant_id: '22222222-2222-4222-8222-222222222222',
  product_slugs: ['cache-phone'],
  related_identifiers: ['shop-one', 'shop.example.com'],
  target_id: 'shop-one',
  target_kind: 'storefront_slug',
};

describe('cacheInvalidationDrainCronResponseSchemas', () => {
  it('accepts at most the claim RPC batch ceiling', () => {
    const five = Array.from({ length: 5 }, (_, index) => ({
      ...claim,
      target_id: `shop-${index}`,
    }));
    expect(
      cacheInvalidationDrainCronResponseSchemas.claims.safeParse(five).success
    ).toBe(true);
    expect(
      cacheInvalidationDrainCronResponseSchemas.claims.safeParse([
        ...five,
        { ...claim, target_id: 'shop-overflow' },
      ]).success
    ).toBe(false);
  });

  it('accepts only a boolean dead-letter alert state', () => {
    expect(
      cacheInvalidationDrainCronResponseSchemas.deadLetters.safeParse(true)
        .success
    ).toBe(true);
    expect(
      cacheInvalidationDrainCronResponseSchemas.deadLetters.safeParse('true')
        .success
    ).toBe(false);
  });
});
