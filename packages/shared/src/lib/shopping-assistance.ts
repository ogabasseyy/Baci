import { z } from 'zod';
import { buildProductSearchQuery } from './product-search';
import {
  parseSearchRefinements,
  type SearchRefinements,
} from './search-refinements';

const money = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
export const searchAssistanceProposalSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .refine((value) => Boolean(buildProductSearchQuery(value).normalized)),
    explanation: z.string().trim().min(1).max(320),
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
      ),
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
/** A proposal is applied only by a customer action; retain existing constraints. */
export function mergeAssistedRefinements(
  current: SearchRefinements,
  proposal: SearchAssistanceProposal
): SearchRefinements {
  const next = { ...current, ...proposal.filters };
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
