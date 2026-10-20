import {
  parseSearchRefinements,
  type SearchRefinements,
} from '@baci/shared/lib';

export interface RefinementDraft
  extends Omit<SearchRefinements, 'minPrice' | 'maxPrice'> {
  minimum: string;
  maximum: string;
}

export const createRefinementDraft = (
  criteria: SearchRefinements
): RefinementDraft => ({
  ...criteria,
  minimum: criteria.minPrice?.toString() ?? '',
  maximum: criteria.maxPrice?.toString() ?? '',
});

export function parseRefinementDraft(draft: RefinementDraft) {
  return parseSearchRefinements({
    brand: draft.brands,
    category: draft.categoryId,
    condition: draft.condition,
    processor: draft.processor,
    minPrice: draft.minimum,
    maxPrice: draft.maximum,
    sort: draft.sort,
    minRating: draft.minRating?.toString(),
  });
}
