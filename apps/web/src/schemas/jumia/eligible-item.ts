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
