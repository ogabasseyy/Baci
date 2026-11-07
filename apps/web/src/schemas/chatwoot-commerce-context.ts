import { z } from 'zod';

const requestIdSchema = z
  .string()
  .min(8)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const websiteTokenSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const digestSchema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]{64}$/);

export const chatwootCommerceChallengeRequestSchema = z
  .object({
    conversationId: z.number().int().positive().safe(),
    requestId: requestIdSchema,
    visitorTokenSha256: digestSchema,
    websiteToken: websiteTokenSchema,
  })
  .strict();

export const chatwootCommerceContextVerifyRequestSchema = z
  .object({
    challengeToken: z.string().min(1).max(12_000),
    contextToken: z.string().min(1).max(12_000),
  })
  .strict();

export const chatwootCommerceSessionAuthorizeRequestSchema = z
  .object({
    sessionToken: z.string().min(1).max(12_000),
    includeCartSnapshot: z.boolean().optional(),
  })
  .strict();

export const chatwootCartReviewSnapshotSchema = z
  .object({
    cartVersion: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    estimatedTotals: z.boolean(),
    items: z
      .array(
        z
          .object({
            lineId: z.string().min(1).max(128),
            name: z.string().min(1).max(120),
            productId: z.string().min(1).max(128),
            variantId: z.string().max(128).nullable(),
            condition: z.string().max(32).nullable(),
            quantity: z.number().int().min(1).max(1000).safe(),
            unitPriceMinor: z.number().int().nonnegative().safe(),
            lineTotalMinor: z.number().int().nonnegative().safe(),
          })
          .strict()
      )
      .max(20),
    itemsSubtotalMinor: z.number().int().nonnegative().safe(),
  })
  .strict();
