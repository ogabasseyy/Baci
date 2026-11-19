import { describe, expect, it } from 'vitest';
import type { StorefrontAgentUiProduct } from '@/schemas/storefront-agent-ui-contract';
import {
  hasForeignCurrencyMention,
  validatePriceSpans,
} from './ogabassey-catalog-agent-prices';

const nokia3310: StorefrontAgentUiProduct = {
  brand: 'Nokia',
  category: 'Phones',
  description: 'Nokia 3310 feature phone',
  hasVariants: false,
  id: 'nokia-3310',
  imageUrl: 'https://cdn.example.com/3310.jpg',
  manageStock: true,
  name: 'Nokia 3310',
  price: 50_000,
  slug: 'nokia-3310',
  stock: 4,
};

describe('ogabassey-catalog-agent-prices', () => {
  it('excludes returned model numbers unless preceded by a price cue', () => {
    expect(
      validatePriceSpans(
        'Nokia 3310 is available for ₦50,000.',
        undefined,
        (_start, amount) => amount === 50_000,
        [nokia3310]
      ).valid
    ).toBe(true);

    expect(
      validatePriceSpans(
        'Nokia 3310 costs 3310.',
        undefined,
        (_start, amount) => amount === 50_000,
        [nokia3310]
      ).valid
    ).toBe(false);
  });

  it('detects textual foreign-currency codes and words alongside symbols', () => {
    expect(
      hasForeignCurrencyMention('Apple MacBook is USD 1,450,000.', 'NGN')
    ).toBe(true);
    expect(hasForeignCurrencyMention('Costs 900 dollars today.', 'NGN')).toBe(
      true
    );
    expect(hasForeignCurrencyMention('Costs 500 pounds.', 'NGN')).toBe(true);
    expect(hasForeignCurrencyMention('Costs ₦1,450,000.', 'NGN')).toBe(false);
  });
});
