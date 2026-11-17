import { z } from 'zod';
import { chatwootProductSlugSchema } from './chatwoot-product-slug';
import { postgresUuidSchema } from './postgres-uuid';

export const chatwootCartAddMutationRequestSchema = z
  .object({
    cartVersion: z.number().int().positive().safe(),
    conversationId: z.number().int().positive().safe(),
    productSlug: chatwootProductSlugSchema,
    requestId: z
      .string()
      .min(8)
      .max(80)
      .regex(/^[A-Za-z0-9_-]+$/),
    sessionToken: z.string().min(1).max(12_000),
    variantId: postgresUuidSchema.optional(),
  })
  .strict();
