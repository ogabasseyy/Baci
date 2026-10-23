import { z } from 'zod';
import { jumiaProductExportEligibleItemSchema } from './eligible-item';

export const jumiaProductExportEligiblePageSchema = z
  .object({
    selectionId: z.string().uuid(),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    totalPages: z.number().int().min(0),
    legacyUnmappedCount: z.number().int().min(0),
    products: z.array(jumiaProductExportEligibleItemSchema),
  })
  .passthrough();

export type JumiaProductExportEligiblePage = z.infer<
  typeof jumiaProductExportEligiblePageSchema
>;
