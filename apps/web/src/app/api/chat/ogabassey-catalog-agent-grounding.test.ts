import { describe, expect, it } from 'vitest';
import type { StorefrontAgentUiEvent } from '@/schemas/storefront-agent-ui-contract';
import {
  hasGroundedCatalogResultText,
  hasGroundedEmptyCatalogText,
} from './ogabassey-catalog-agent-grounding';

const macbookEvent: StorefrontAgentUiEvent[] = [
  {
    intent: 'discover',
    products: [
      {
        brand: 'Apple',
        category: 'Laptops',
        description: 'Apple MacBook Air M2',
        hasVariants: false,
        id: 'mac-1',
        imageUrl: 'https://cdn.example.com/mac.jpg',
        manageStock: true,
        name: 'Apple MacBook Air M2',
        price: 1_450_000,
        slug: 'apple-macbook-air-m2',
        stock: 3,
      },
    ],
    title: 'Products I found',
    type: 'present_products',
  },
];

describe('ogabassey-catalog-agent-grounding', () => {
  it('scopes budget restatements strictly to the active budget and rejects stale or foreign-currency prices', () => {
    const activeBudget = { amount: 2_000_000, exclusive: true };

    expect(
      hasGroundedCatalogResultText(
        'Apple MacBook Air M2 is ₦1,450,000 under your ₦2,000,000 budget.',
        macbookEvent,
        'NGN',
        activeBudget
      )
    ).toBe(true);

    // Stale historical amount (₦300k from a previous query) must not bypass price checks
    expect(
      hasGroundedCatalogResultText(
        'Apple MacBook Air M2 is ₦1,450,000 and fits your ₦300k budget.',
        macbookEvent,
        'NGN',
        activeBudget
      )
    ).toBe(false);

    // Foreign currency symbol on NGN price is always rejected
    expect(
      hasGroundedCatalogResultText(
        'Apple MacBook Air M2 is $1,450,000.',
        macbookEvent,
        'NGN',
        activeBudget
      )
    ).toBe(false);

    // Short cued bare prices fail closed while 4K display specs pass
    expect(
      hasGroundedCatalogResultText(
        'Apple MacBook Air M2 costs 999.',
        macbookEvent,
        'NGN',
        activeBudget
      )
    ).toBe(false);
    expect(
      hasGroundedCatalogResultText(
        'Apple MacBook Air M2 supports a 4K display at ₦1,450,000.',
        macbookEvent,
        'NGN',
        activeBudget
      )
    ).toBe(true);
  });

  it('rejects grouped multi-product price mismatches and validates stock and empty-result budget restatements', () => {
    const dualEvents: StorefrontAgentUiEvent[] = [
      {
        intent: 'discover',
        products: [
          {
            ...macbookEvent[0].products[0],
            id: 'p1',
            name: 'Apple iPhone 16',
            price: 1_200_000,
            slug: 'iphone-16',
          },
          {
            ...macbookEvent[0].products[0],
            id: 'p2',
            name: 'Apple iPhone 15',
            price: 900_000,
            slug: 'iphone-15',
          },
        ],
        title: 'Products I found',
        type: 'present_products',
      },
    ];

    expect(
      hasGroundedCatalogResultText(
        'Apple iPhone 16, Apple iPhone 15 are both ₦900,000.',
        dualEvents,
        'NGN'
      )
    ).toBe(false);

    expect(
      hasGroundedCatalogResultText(
        'Apple MacBook Air M2 is ₦1,450,000—only 5 left.',
        macbookEvent,
        'NGN'
      )
    ).toBe(false);

    expect(
      hasGroundedEmptyCatalogText(
        'Sorry, nothing under ₦2,000,000 matched your search.',
        'NGN',
        { amount: 2_000_000, exclusive: true }
      )
    ).toBe(true);
    expect(
      hasGroundedEmptyCatalogText('Nothing matched under ₦300k.', 'NGN', {
        amount: 2_000_000,
        exclusive: true,
      })
    ).toBe(false);
  });
});
