import { z } from 'zod';

export const jumiaProductExportEligibleItemSchema = z
  .object({
    id: z.string().min(1),
    available: z.boolean(),
    unavailableReason: z.string().nullable(),
    capturedSourceVersion: z.string().min(1),
    currentSourceVersion: z.string().min(1).nullable(),
    product: z
      .object({
        product: z
          .object({ name: z.string().nullable().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .nullable(),
  })
  .passthrough();

export const jumiaProductExportEligiblePageSchema = z
  .object({
    selectionId: z.string().min(1),
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
