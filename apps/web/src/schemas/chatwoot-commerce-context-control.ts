import { z } from 'zod';

const conversationId = z.number().int().positive().safe();

const contextRequestId = z
  .string()
  .min(8)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);

export const chatwootCommerceContextControlSchema = z.discriminatedUnion(
  'event',
  [
    z
      .object({
        event: z.literal('baci-commerce-context-request'),
        data: z
          .object({
            requestId: contextRequestId,
            conversationId,
            websiteToken: z
              .string()
              .min(16)
              .max(128)
              .regex(/^[A-Za-z0-9_-]+$/),
            visitorTokenSha256: z
              .string()
              .length(64)
              .regex(/^[0-9a-f]{64}$/),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        event: z.literal('baci-commerce-context-ready'),
        data: z
          .object({
            requestId: contextRequestId,
            conversationId,
            contextToken: z.string().min(1).max(12_000),
            expiresAt: z.number().int().positive().safe(),
          })
          .strict(),
      })
      .strict(),
  ]
);
