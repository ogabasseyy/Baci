/**
 * Minimum trimmed query length that activates product search across the
 * mobile storefront (home submission, dropdown suggestions, results screen,
 * and search-history writes). Keep this as the single threshold so entry
 * points can never accept a query the results route would reject.
 */
export const MIN_SEARCH_QUERY_LENGTH = 2;

/**
 * Maximum submitted query length, shared by home submission and the results
 * route parser (which also sees direct deep links). Matches the storefront
 * navbar entry limit so over-long pastes can never reach the route, the
 * search RPC, history, or widgets unbounded.
 */
export const MAX_SEARCH_QUERY_LENGTH = 100;
