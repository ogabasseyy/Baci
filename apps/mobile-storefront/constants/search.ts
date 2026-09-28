/**
 * Minimum trimmed query length that activates product search across the
 * mobile storefront (home submission, dropdown suggestions, results screen,
 * and search-history writes). Keep this as the single threshold so entry
 * points can never accept a query the results route would reject.
 */
export const MIN_SEARCH_QUERY_LENGTH = 2;
