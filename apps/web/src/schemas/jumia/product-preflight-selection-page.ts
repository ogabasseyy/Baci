import { z } from 'zod';

export const jumiaProductPreflightSelectionPageSchema = z
  .object({
    selectionId: z.uuid(),
    sourceCategoryId: z.uuid(),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    totalPages: z.number().int().nonnegative(),
    products: z.array(
      z
        .object({
          id: z.uuid(),
          ordinal: z.number().int().positive(),
          capturedSourceVersion: z.string(),
          currentSourceVersion: z.string().nullable(),
          available: z.boolean(),
          unavailableReason: z.string().nullable(),
          product: z.unknown().nullable(),
        })
        .passthrough()
    ),
  })
  .passthrough();
