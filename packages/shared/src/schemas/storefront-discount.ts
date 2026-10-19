import { z } from 'zod';

/**
 * Request body for the storefront discount-code validation endpoint
 * (`POST /api/storefront/discount/validate`). Shared by web + mobile.
 *
 * `product_ids` / `category_ids` are optional and used only for
 * non-authoritative targeted-code UX preflight — the order RPC remains the
 * sole enforcement boundary for `applies_to`.
 */
export const StorefrontDiscountValidateRequestSchema = z.object({
  merchant_id: z.uuid(),
  code: z.string().trim().min(1).max(50),
  cart_total: z.number().nonnegative(),
  product_ids: z.array(z.string().min(1)).optional(),
  category_ids: z.array(z.string().min(1)).optional(),
});

const AppliedDiscountResponseSchema = z.object({
  valid: z.literal(true),
  // Null for loyalty redemptions: no discount_codes row exists, and the
  // internal redemption id stays out of anon reach by design.
  discount_code_id: z.uuid().nullable(),
  code: z.string().trim().min(1),
  discount_type: z.enum(['percentage', 'fixed']),
  discount_value: z.number(),
  discount_amount: z.number().nonnegative(),
  minimum_order: z.number().nonnegative().optional(),
  description: z.string().nullable().optional(),
});

const RejectedDiscountResponseSchema = z.object({
  valid: z.literal(false),
  error: z.string().min(1),
  details: z.unknown().optional(),
});

/**
 * Strict success/failure union: a `{ valid: true }` response MUST carry the
 * discount details, so a client can never accept a malformed "valid" response
 * that lacks an amount.
 */
export const StorefrontDiscountValidateResponseSchema = z.discriminatedUnion(
  'valid',
  [AppliedDiscountResponseSchema, RejectedDiscountResponseSchema]
);

export type StorefrontDiscountValidateRequest = z.infer<
  typeof StorefrontDiscountValidateRequestSchema
>;
export type StorefrontDiscountValidateResponse = z.infer<
  typeof StorefrontDiscountValidateResponseSchema
>;
