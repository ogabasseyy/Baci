import { parseSearchRefinements } from './parse-search-refinements';
import { resetRefinementsForQuery } from './reset-refinements-for-query';
import type { SearchAssistanceProposal } from './search-assistance-proposal-schema';
import type { SearchRefinements } from './search-refinement-types';

/**
 * A proposal is applied only by a customer action. Constraints carry over
 * only when the proposal answers the committed results query; a proposal
 * for a different query starts from empty refinements (mirroring form
 * submission), otherwise stale brand/category/processor constraints the
 * proposal cannot express would produce false no-results.
 */
export function mergeAssistedRefinements(
  current: SearchRefinements,
  proposal: SearchAssistanceProposal,
  committedQuery: string
): SearchRefinements {
  const base = resetRefinementsForQuery(
    committedQuery,
    proposal.query,
    current
  );
  const next = { ...base, ...proposal.filters };
  const parsed = parseSearchRefinements({
    brand: next.brands,
    condition: next.condition,
    processor: next.processor,
    category: next.categoryId,
    minPrice: next.minPrice?.toString(),
    maxPrice: next.maxPrice?.toString(),
    minRating: next.minRating?.toString(),
    sort: next.sort,
  });
  if (!parsed.success) throw new Error(parsed.error);
  return parsed.data;
}
