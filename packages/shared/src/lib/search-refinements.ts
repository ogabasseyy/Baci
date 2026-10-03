import { z } from 'zod';
import { buildProductSearchQuery } from './product-search';

export const SEARCH_SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most viewed' },
] as const;
export type SearchSort = (typeof SEARCH_SORT_OPTIONS)[number]['value'];
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
export const emptySearchRefinements = (): SearchRefinements => ({
  brands: [],
  sort: 'relevance',
});
const optionalNumber = z.preprocess((value) => {
  if (value == null || (typeof value === 'string' && value.trim() === ''))
    return undefined;
  if (typeof value === 'string' && /^\d+(\.\d{1,2})?$/.test(value.trim()))
    return Number(value);
  return value;
}, z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).optional());
const criteriaSchema = z
  .object({
    processor: z.string().trim().min(1).max(80).optional(),
    brands: z
      .array(
        z
          .string()
          .min(1)
          .max(160)
          .refine((value) => value.trim().length > 0)
      )
      .max(50),
    sort: z.enum(['relevance', 'price_asc', 'price_desc', 'newest', 'popular']),
    categoryId: z.string().uuid().optional(),
    condition: z.enum(['new', 'used', 'open_box']).optional(),
    minPrice: optionalNumber,
    maxPrice: optionalNumber,
    minRating: optionalNumber.pipe(z.number().min(0).max(5).optional()),
  })
  .refine(
    (value) =>
      value.minPrice === undefined ||
      value.maxPrice === undefined ||
      value.minPrice <= value.maxPrice,
    {
      message: 'Minimum price must not exceed maximum price',
      path: ['maxPrice'],
    }
  );

export function parseSearchRefinements(
  input: RefinementParams
):
  | { success: true; data: SearchRefinements }
  | { success: false; error: string } {
  const brands =
    input.brand == null
      ? []
      : Array.isArray(input.brand)
        ? input.brand
        : [input.brand];
  const sort = SEARCH_SORT_OPTIONS.some((option) => option.value === input.sort)
    ? input.sort
    : 'relevance';
  if (Array.isArray(input.sort))
    return { success: false, error: 'Choose one sort order' };
  const parsed = criteriaSchema.safeParse({
    brands: [...new Set(brands)].sort(),
    sort,
    categoryId: input.category || undefined,
    condition: input.condition || undefined,
    processor: input.processor || undefined,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    minRating: input.minRating,
  });
  if (!parsed.success)
    return {
      success: false,
      error: 'Check your filter values and price range',
    };
  return { success: true, data: parsed.data as SearchRefinements };
}

export function buildRefinedSearchHref(
  path: string,
  query: string,
  criteria: SearchRefinements,
  page?: number
): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  for (const brand of [...new Set(criteria.brands)].sort())
    params.append('brand', brand);
  if (criteria.categoryId) params.set('category', criteria.categoryId);
  if (criteria.condition) params.set('condition', criteria.condition);
  if (criteria.processor) params.set('processor', criteria.processor);
  for (const key of ['minPrice', 'maxPrice', 'minRating'] as const) {
    if (criteria[key] !== undefined) params.set(key, String(criteria[key]));
  }
  if (criteria.sort !== 'relevance') params.set('sort', criteria.sort);
  if (query && page !== undefined) params.set('page', String(page));
  return params.size ? `${path}?${params}` : path;
}

export function hasActiveSearchRefinements(
  criteria: SearchRefinements
): boolean {
  // Sort order never empties a result set, so only filter-bearing fields
  // count. Used to suppress product-request intake on refinement-only
  // zero-result pages.
  return (
    criteria.brands.length > 0 ||
    criteria.categoryId !== undefined ||
    criteria.condition !== undefined ||
    criteria.minPrice !== undefined ||
    criteria.maxPrice !== undefined ||
    criteria.minRating !== undefined ||
    criteria.processor !== undefined
  );
}

export function resetRefinementsForQuery(
  previous: string,
  next: string,
  current: SearchRefinements
): SearchRefinements {
  return buildProductSearchQuery(previous).normalized ===
    buildProductSearchQuery(next).normalized
    ? current
    : emptySearchRefinements();
}
