export const SEARCH_SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most viewed' },
] as const;
export type SearchSort = (typeof SEARCH_SORT_OPTIONS)[number]['value'];
