import { describe, expect, it } from 'vitest';
import { cacheInvalidationPurgeCausalKey } from './cache-invalidation-purge-causal-key';

const merchant = '22222222-2222-4222-8222-222222222222';

describe('cacheInvalidationPurgeCausalKey', () => {
  it('coalesces slug and hostname rows with matching shared coverage', () => {
    expect(
      cacheInvalidationPurgeCausalKey({
        generation: 6,
        merchant_id: merchant,
        product_slugs: ['phone', 'case'],
        related_identifiers: ['shop-one', 'shop.example.com'],
        target_id: 'shop-one',
        target_kind: 'storefront_slug',
      })
    ).toBe(
      cacheInvalidationPurgeCausalKey({
        generation: 6,
        merchant_id: merchant,
        product_slugs: ['case', 'phone'],
        related_identifiers: ['shop.example.com', 'shop-one'],
        target_id: 'shop.example.com',
        target_kind: 'storefront_hostname',
      })
    );
  });

  it('keeps shared-generation siblings separate when related identifiers differ', () => {
    expect(
      cacheInvalidationPurgeCausalKey({
        generation: 6,
        merchant_id: merchant,
        product_slugs: ['phone'],
        related_identifiers: ['shop-one'],
        target_id: 'shop-one',
        target_kind: 'storefront_slug',
      })
    ).not.toBe(
      cacheInvalidationPurgeCausalKey({
        generation: 6,
        merchant_id: merchant,
        product_slugs: ['phone'],
        related_identifiers: ['shop-two'],
        target_id: 'shop-two',
        target_kind: 'storefront_slug',
      })
    );
  });

  it('keeps shared-generation siblings separate when product slug coverage differs', () => {
    expect(
      cacheInvalidationPurgeCausalKey({
        generation: 6,
        merchant_id: merchant,
        product_slugs: ['phone'],
        related_identifiers: ['shop-one', 'shop.example.com'],
        target_id: 'shop-one',
        target_kind: 'storefront_slug',
      })
    ).not.toBe(
      cacheInvalidationPurgeCausalKey({
        generation: 6,
        merchant_id: merchant,
        product_slugs: ['phone', 'case'],
        related_identifiers: ['shop-one', 'shop.example.com'],
        target_id: 'shop-two',
        target_kind: 'storefront_slug',
      })
    );
  });

  it('keeps same-generation product claims on distinct target ids separate', () => {
    expect(
      cacheInvalidationPurgeCausalKey({
        generation: 1,
        merchant_id: merchant,
        product_slugs: [],
        related_identifiers: [],
        target_id: '11111111-1111-4111-8111-111111111111',
        target_kind: 'storefront_product',
      })
    ).not.toBe(
      cacheInvalidationPurgeCausalKey({
        generation: 1,
        merchant_id: merchant,
        product_slugs: [],
        related_identifiers: [],
        target_id: '11111111-1111-4111-8111-111111111112',
        target_kind: 'storefront_product',
      })
    );
  });
});

it('canonicalizes duplicate coverage entries so identical sets share a key', () => {
  expect(
    cacheInvalidationPurgeCausalKey({
      generation: 6,
      merchant_id: merchant,
      product_slugs: ['phone', 'phone'],
      related_identifiers: ['shop-one', 'shop-one', 'shop.example.com'],
      target_id: 'shop-one',
      target_kind: 'storefront_slug',
    })
  ).toBe(
    cacheInvalidationPurgeCausalKey({
      generation: 6,
      merchant_id: merchant,
      product_slugs: ['phone'],
      related_identifiers: ['shop.example.com', 'shop-one'],
      target_id: 'shop-two',
      target_kind: 'storefront_slug',
    })
  );
});
