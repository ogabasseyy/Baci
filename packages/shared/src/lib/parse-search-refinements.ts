import { criteriaSchema } from './search-refinement-criteria-schema';
import type {
  RefinementParams,
  SearchRefinements,
} from './search-refinement-types';
import { SEARCH_SORT_OPTIONS } from './search-sort-options';

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
