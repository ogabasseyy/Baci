import { z } from 'zod';

export const chatwootCartAddMutationRequestSchema = z
  .object({
    cartVersion: z.number().int().positive().safe(),
    conversationId: z.number().int().positive().safe(),
    productSlug: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+)*$/),
    requestId: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_-]+$/),
    sessionToken: z.string().min(1).max(12_000),
    variantId: z.uuid().optional(),
  })
  .strict();
