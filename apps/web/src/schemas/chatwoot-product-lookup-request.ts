import { z } from 'zod';

export const chatwootProductLookupRequestSchema = z
  .object({
    conversationId: z.number().int().positive().safe(),
    requestId: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_-]+$/),
    sessionToken: z.string().min(1).max(12_000),
    slug: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+)*$/),
  })
  .strict();
