import { describe, expect, it } from 'vitest';
import {
  filterTransactionOrders,
  splitTransactionSearchTerms,
  TRANSACTION_REVIEW_MAX_SEARCH_TERMS,
} from './transaction-review-search-terms';
import type { TransactionReviewOrder } from './transaction-review-types';

describe('splitTransactionSearchTerms', () => {
  it('folds case, dedups, and trims overlong terms', () => {
    expect(
      splitTransactionSearchTerms(`  Ada ADA buyer ${'x'.repeat(70)}`)
    ).toEqual(['ada', 'buyer', 'x'.repeat(60)]);
  });

  it('selects a deterministic subset past the term cap', () => {
    // The refinement filter re-applies this splitter to RPC results, so
    // the capped subset must be deterministic: sorted JS-order first-N.
    // (Sort parity with the server holds for ASCII; non-ASCII queries
    // past the cap may select a different subset — documented in the
    // splitter, low severity for admin search.)
    const terms = Array.from(
      { length: TRANSACTION_REVIEW_MAX_SEARCH_TERMS + 2 },
      (_, index) => `term${String(index).padStart(2, '0')}`
    );
    expect(terms).toHaveLength(12);
    expect(splitTransactionSearchTerms([...terms].reverse().join(' '))).toEqual(
      [...terms].sort().slice(0, TRANSACTION_REVIEW_MAX_SEARCH_TERMS)
    );
  });

  it('returns no terms for blank queries', () => {
    expect(splitTransactionSearchTerms('   ')).toEqual([]);
  });
});

describe('filterTransactionOrders', () => {
  const order = {
    searchText: 'ada buyer lagos',
  } as TransactionReviewOrder;

  it('keeps orders matching every capped term', () => {
    expect(filterTransactionOrders([order], 'Ada buyer')).toEqual([order]);
    expect(filterTransactionOrders([order], 'Ada seller')).toEqual([]);
  });

  it('returns all orders for blank queries', () => {
    expect(filterTransactionOrders([order], '   ')).toEqual([order]);
  });
});
