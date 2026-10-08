import { z } from 'zod';

export const availableSearchFacetsSchema = z.object({
  brands: z.array(z.string()),
  processors: z.array(z.string()).optional(),
  categories: z.array(z.object({ id: z.string(), name: z.string() })),
  conditions: z.array(z.enum(['new', 'used', 'open_box'])),
  minPrice: z.number().finite().nonnegative().nullable(),
  maxPrice: z.number().finite().nonnegative().nullable(),
});
export type AvailableSearchFacets = z.infer<typeof availableSearchFacetsSchema>;
