import type { SearchSort } from './search-sort-options';

export interface SearchRefinements {
  brands: string[];
  sort: SearchSort;
  categoryId?: string;
  condition?: 'new' | 'used' | 'open_box';
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  processor?: string;
}
export type RefinementParams = Record<
  string,
  string | string[] | null | undefined
>;
