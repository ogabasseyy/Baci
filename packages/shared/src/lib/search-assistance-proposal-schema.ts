import { z } from 'zod';
import { searchAssistanceQuerySchema } from './search-assistance-query-schema';

const money = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);

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
