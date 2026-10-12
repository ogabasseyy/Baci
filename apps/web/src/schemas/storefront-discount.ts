import { z } from 'zod';

export const storefrontDiscountValidateSchema = z.object({
  merchant_id: z.uuid(),
  code: z.string().trim().min(1),
  cart_total: z.number().nonnegative(),
  // Optional cart targeting hints for non-authoritative UX preflight only —
  // the order RPC remains the sole enforcement boundary for `applies_to`.
  product_ids: z.array(z.string().min(1)).optional(),
  category_ids: z.array(z.string().min(1)).optional(),
});

export type StorefrontDiscountValidateInput = z.infer<
  typeof storefrontDiscountValidateSchema
>;

export const storefrontDiscountCodeRowSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  discount_type: z.enum(['percentage', 'fixed_amount']),
  discount_value: z.coerce.number(),
  starts_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  usage_limit: z.coerce.number().nullable(),
  usage_count: z.coerce.number(),
  minimum_purchase_amount: z.coerce.number().nullable(),
  maximum_discount_amount: z.coerce.number().nullable(),
  description: z.string().nullable(),
  // Targeting columns returned by the extended get_storefront_discount_code RPC.
  // The order route does NOT gate on these (eligibility is RPC-authoritative);
  // the validate endpoint uses them for UX preflight. Null-tolerant for defense.
  applies_to: z
    .enum(['all', 'specific_products', 'specific_categories'])
    .catch('all'),
  product_ids: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  category_ids: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  usage_limit_per_customer: z.coerce.number().nullable(),
});

export type StorefrontDiscountCodeRow = z.infer<
  typeof storefrontDiscountCodeRowSchema
>;

// Row returned by get_loyalty_redemption_for_checkout (issue #3165). The
// resolve RPC is type-agnostic; only discount_fixed/discount_percentage with
// a positive value are bridgeable — the call sites filter, and the order
// wrapper re-verifies authoritatively. Snapshot-governed: no live reward
// state is selected, so a later disable cannot strand a paid code.
export const loyaltyCheckoutCodeRowSchema = z.object({
  redemption_id: z.uuid(),
  reward_type: z.string(),
  // nullable() (not nullish()): the resolve RPC always selects these
  // columns, so a MISSING key is a contract break that must fail.
  reward_value: z.coerce.number().nullable(),
  minimum_order_amount: z.coerce.number().nullable(),
  expires_at: z.string().nullable(),
  used: z.boolean(),
  issuance_currency: z.string().nullable(),
  reward_name: z.string().nullable(),
});

export type LoyaltyCheckoutCodeRow = z.infer<
  typeof loyaltyCheckoutCodeRowSchema
>;
