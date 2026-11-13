import { z } from 'zod';

export const chatwootContextRequestSchemas = {
  challenge: z
    .object({
      conversationId: z.number().int().positive(),
      requestId: z.string().min(1),
      visitorTokenSha256: z.string().regex(/^[a-f\d]{64}$/i),
      websiteToken: z.string().min(1),
    })
    .strict(),
  verify: z
    .object({
      challengeToken: z.string().min(1),
      contextToken: z.string().min(1),
    })
    .strict(),
  authorize: z
    .object({
      includeCartSnapshot: z.literal(true),
      sessionToken: z.string().min(1),
    })
    .strict(),
};
