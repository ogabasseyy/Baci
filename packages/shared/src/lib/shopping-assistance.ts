import { z } from 'zod';
import { parseSearchRefinements } from './parse-search-refinements';
import { buildProductSearchQuery } from './product-search';
import { resetRefinementsForQuery } from './reset-refinements-for-query';
import type { SearchRefinements } from './search-refinement-types';

const money = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
// Single source for the assistance query rule (trimmed 2–120 chars plus a
// catalog term): the request schema, the proposal schema, and both
// storefront gates validate against this field so the advertised action
// can never promise a request the API would reject.
export const searchAssistanceQuerySchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .refine((value) => Boolean(buildProductSearchQuery(value).normalized));
export const searchAssistanceProposalSchema = z
  .object({
    query: searchAssistanceQuerySchema,
    explanation: z.string().trim().min(1).max(320),
    // The object defaults to {} when a compliant provider omits it
    // (the prompt forbids inventing filters for subjective asks); its
    // properties stay optional.
    filters: z
      .object({
        brands: z.array(z.string().trim().min(1).max(160)).max(5).optional(),
        condition: z.enum(['new', 'used', 'open_box']).optional(),
        minPrice: money.optional(),
        maxPrice: money.optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.minPrice === undefined ||
          value.maxPrice === undefined ||
          value.minPrice <= value.maxPrice
      )
      .optional()
      .default({}),
  })
  .strict();
export type SearchAssistanceProposal = z.infer<
  typeof searchAssistanceProposalSchema
>;
export function parseSearchAssistanceProposal(
  value: unknown
): SearchAssistanceProposal {
  return searchAssistanceProposalSchema.parse(value);
}
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
