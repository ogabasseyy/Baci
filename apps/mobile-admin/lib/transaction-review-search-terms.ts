import type { TransactionReviewOrder } from './transaction-review-types';

// Mirror of the search RPC's normalization
// (20261008174300_search_mobile_admin_transaction_review_orders.sql): the
// server distinct-caps terms to bound planning cost, so the client applies
// the same terms before sending AND before refining. Otherwise the server
// would match a weakened subset, fill its cap with newer subset matches,
// and hide an older order matching the full query. Both callers of this
// splitter (the RPC sender and the refinement filter) stay aligned by
// construction. Terms are case-folded before dedup, mirroring the
// server's lower() DISTINCT; sort-order parity with the server holds for
// ASCII terms, so non-ASCII queries past the term cap may still select a
// different subset (database collation vs JS sort).
export const TRANSACTION_REVIEW_MAX_SEARCH_TERMS = 10;
export const TRANSACTION_REVIEW_MAX_SEARCH_TERM_LENGTH = 60;

export function splitTransactionSearchTerms(searchQuery: string) {
  const terms = [
    ...new Set(
      searchQuery
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((term) =>
          term.slice(0, TRANSACTION_REVIEW_MAX_SEARCH_TERM_LENGTH).toLowerCase()
        )
    ),
  ];
  terms.sort();
  return terms.slice(0, TRANSACTION_REVIEW_MAX_SEARCH_TERMS);
}

export function filterTransactionOrders(
  orders: TransactionReviewOrder[],
  searchQuery: string
) {
  const terms = splitTransactionSearchTerms(searchQuery.toLowerCase());

  if (terms.length === 0) {
    return orders;
  }

  return orders.filter((order) =>
    terms.every((term) => order.searchText.includes(term))
  );
}
