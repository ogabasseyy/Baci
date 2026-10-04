import { buildProductSearchQuery } from '@baci/shared/lib';
import { z } from 'zod';
export const searchAssistanceRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    query: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .refine((value) => Boolean(buildProductSearchQuery(value).normalized)),
  })
  .strict();
