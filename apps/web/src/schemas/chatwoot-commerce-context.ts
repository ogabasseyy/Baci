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

export const chatwootCartQuantityMutationRequestSchema = z
  .object({
    cartVersion: z.number().int().positive(),
    conversationId: z.number().int().positive().safe(),
    expectedQuantity: z.number().int().min(1).max(1000),
    lineId: z.string().trim().min(1).max(64),
    quantity: z.number().int().min(0).max(10),
    requestId: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_-]+$/),
    sessionToken: z.string().min(1).max(12_000),
  })
  .strict();
