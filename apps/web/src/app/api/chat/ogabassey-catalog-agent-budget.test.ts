import { describe, expect, it } from 'vitest';
import {
  constrainSearchParamsWithBudget,
  filterSerializedDetailsResultByBudget,
  filterSerializedSearchResultByBudget,
  filterToolResultByBudget,
  hasInvalidLatestBudget,
  isProductWithinBudget,
  resolveConversationBudgetLimit,
} from './ogabassey-catalog-agent-budget';

describe('ogabassey-catalog-agent-budget', () => {
  it('resolves active conversation budgets, handles follow-up overrides safely, and isolates category shifts', () => {
    expect(
      resolveConversationBudgetLimit(
        [{ role: 'user', content: 'Show laptops under ₦2m' }],
        'NGN'
      )
    ).toEqual({ amount: 2_000_000, exclusive: true });

    // Non-price "over 512GB" spec filter preserves prior budget
    expect(
      resolveConversationBudgetLimit(
        [
          { role: 'user', content: 'Show laptops under ₦2m' },
          { role: 'user', content: 'Show laptops with storage over 512GB' },
        ],
        'NGN'
      )
    ).toEqual({ amount: 2_000_000, exclusive: true });

    // Comparative follow-up without an explicit budget override retains the cap
    expect(
      resolveConversationBudgetLimit(
        [
          { role: 'user', content: 'Show laptops under ₦2m' },
          { role: 'user', content: 'Show me more expensive options' },
        ],
        'NGN'
      )
    ).toEqual({ amount: 2_000_000, exclusive: true });

    // Explicit price override clears prior cap on current and subsequent continuation turns
    expect(
      resolveConversationBudgetLimit(
        [
          { role: 'user', content: 'Show laptops under ₦2m' },
          { role: 'user', content: 'Show laptops over ₦2m instead' },
        ],
        'NGN'
      )
    ).toBeUndefined();
    expect(
      resolveConversationBudgetLimit(
        [
          { role: 'user', content: 'Show laptops under ₦2m' },
          { role: 'user', content: 'Show laptops at any price' },
          { role: 'user', content: 'one for rendering' },
        ],
        'NGN'
      )
    ).toBeUndefined();

    // Unrelated category shift and intervening category shifts drop prior caps
    expect(
      resolveConversationBudgetLimit(
        [
          { role: 'user', content: 'Show phones under ₦300k' },
          { role: 'user', content: 'Recommend a camera' },
        ],
        'NGN'
      )
    ).toBeUndefined();
    expect(
      resolveConversationBudgetLimit(
        [
          { role: 'user', content: 'Show phones under ₦300k' },
          { role: 'user', content: 'Show laptops' },
          { role: 'user', content: 'one for work' },
        ],
        'NGN'
      )
    ).toBeUndefined();

    // Invalid budget follow-up returns undefined instead of re-applying a stale cap
    expect(
      resolveConversationBudgetLimit(
        [
          { role: 'user', content: 'Show laptops below 2m' },
          { role: 'user', content: 'Can I get one under $500?' },
        ],
        'NGN'
      )
    ).toBeUndefined();
    expect(
      hasInvalidLatestBudget(
        [
          { role: 'user', content: 'Show laptops below 2m' },
          { role: 'user', content: 'Can I get one under $500?' },
        ],
        'NGN'
      )
    ).toBe(true);
  });

  it('enforces budget bounds cleanly and fails closed without sentinel leaks on malformed JSON', () => {
    const budget = { amount: 2_000_000, exclusive: true };

    expect(isProductWithinBudget(1_999_999, budget)).toBe(true);
    expect(isProductWithinBudget(2_000_000, budget)).toBe(false);
    expect(isProductWithinBudget('1450000', budget)).toBe(false);

    expect(
      constrainSearchParamsWithBudget(
        { query: 'MacBook', minPrice: 2_500_000 },
        budget
      )
    ).toEqual({
      query: 'MacBook',
      minPrice: 2_500_000,
      maxPrice: 2_000_000,
    });

    expect(
      filterToolResultByBudget(
        'getProductDetails',
        { id: '1', name: 'Item', price: '1000000' },
        budget
      )
    ).toBeNull();

    expect(
      JSON.parse(filterSerializedSearchResultByBudget('bad-json', budget))
    ).toEqual({
      products: [],
      total: 0,
    });
    expect(
      JSON.parse(filterSerializedDetailsResultByBudget('bad-json', budget))
    ).toEqual({ available: false });
  });
});
