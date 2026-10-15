import { z } from 'zod';
import { formatPersonName } from '@/lib/format-person-name';
import {
  sanitizeEmail,
  sanitizePhone,
  sanitizeText,
} from '@/lib/sanitize-core';
import { orderDeliveryMetadataSchema } from './checkout-delivery-metadata';
import { optionalHttpUrlSchema } from './order-create-fields';
import { orderShippingAddressSchema } from './order-shipping-address';

export { merchantOrderCancellationSchema } from './merchant-order-cancellation';
export { orderIdParamsSchema } from './order-id-params';
export type { RecordPaymentInput } from './order-record-payment';
export { type OrderUpdateInput, orderUpdateSchema } from './order-update';
export {
  type ReuseCheckoutOrderInput,
  reuseCheckoutOrderSchema,
} from './reuse-checkout-order';

const optionalVariantNameSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z
    .string()
    .optional()
    .transform((val) => {
      if (!val) {
        return val;
      }

      const sanitized = sanitizeText(val).trim();
      return sanitized.length > 0 ? sanitized : undefined;
    })
);

const VOUCHER_TOKEN_MAX_LENGTH = 512;

const optionalVoucherTokenSchema = z.preprocess((value) => {
  if (value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const sanitized = sanitizeText(value.trim());

  return sanitized.length > 0 ? sanitized : undefined;
}, z.string().max(VOUCHER_TOKEN_MAX_LENGTH).optional());

function matchingAliasFields<Left extends string, Right extends string>(
  left: Left,
  right: Right
) {
  return (data: { [Key in Left | Right]?: unknown }) => {
    const leftValue = data[left];
    const rightValue = data[right];

    return !leftValue || !rightValue || leftValue === rightValue;
  };
}

function aliasFieldsMismatchMessage(left: string, right: string) {
  return `${left} and ${right} must match when both are provided`;
}

const orderCreateSchemaBase = z
  .object({
    merchant_id: z.uuid(),
    customer_email: z.email().transform((val) => sanitizeEmail(val)),
    customer_name: z
      .string()
      .min(1)
      .transform((val) => formatPersonName(sanitizeText(val))),
    customer_phone: z
      .string()
      .optional()
      .transform((val) => (val ? sanitizePhone(val) : val)),
    items: z
      .array(
        z
          .object({
            product_id: z.string().optional(),
            productId: z.string().optional(),
            id: z.string().optional(),
            name: z
              .string()
              .min(1)
              .transform((val) => sanitizeText(val)),
            productName: z
              .string()
              .optional()
              .transform((val) => (val ? sanitizeText(val) : val)),
            quantity: z.int().positive(),
            price: z.number().nonnegative(),
            negotiatedPrice: z.number().nonnegative().optional(),
            value: z.number().nonnegative().optional(),
            imageUrl: optionalHttpUrlSchema,
            image_url: optionalHttpUrlSchema,
            has_assurance: z.boolean().optional(),
            assurance_fee: z.number().nonnegative().optional(),
            condition: z
              .string()
              .optional()
              .transform((val) =>
                val
                  ? sanitizeText(val)
                      .trim()
                      .toLowerCase()
                      .replace(/[\s-]+/g, '_')
                  : val
              ),
            variantId: z.string().optional(),
            variant_id: z.string().optional(),
            variantName: optionalVariantNameSchema,
            variant_name: optionalVariantNameSchema,
            variantAttributes: z
              .record(
                z.string(),
                z.string().transform((val) => sanitizeText(val).trim())
              )
              .optional(),
            variant_attributes: z
              .record(
                z.string(),
                z.string().transform((val) => sanitizeText(val).trim())
              )
              .optional(),
            voucherAwardId: optionalVoucherTokenSchema,
            voucherToken: optionalVoucherTokenSchema,
            voucher_award_id: optionalVoucherTokenSchema,
            voucher_token: optionalVoucherTokenSchema,
          })
          .refine((data) => data.product_id || data.productId || data.id, {
            error:
              'At least one product identifier (product_id, productId, or id) is required',
          })
          .refine(matchingAliasFields('imageUrl', 'image_url'), {
            error: aliasFieldsMismatchMessage('imageUrl', 'image_url'),
          })
          .refine(matchingAliasFields('variantName', 'variant_name'), {
            error: aliasFieldsMismatchMessage('variantName', 'variant_name'),
          })
          .refine(matchingAliasFields('voucherToken', 'voucher_token'), {
            error: aliasFieldsMismatchMessage('voucherToken', 'voucher_token'),
          })
          .refine(matchingAliasFields('voucherAwardId', 'voucher_award_id'), {
            error: aliasFieldsMismatchMessage(
              'voucherAwardId',
              'voucher_award_id'
            ),
          })
      )
      .min(1),
    subtotal: z.coerce.number().nonnegative(),
    shipping_fee: z.coerce.number().nonnegative().prefault(0),
    discount_amount: z.coerce.number().nonnegative().prefault(0),
    // Storefront discount code (human code string). Resolved + validated
    // server-side; the route routes order creation through the self-policing
    // `create_storefront_order_with_discount_code` RPC. Raw `discount_amount`
    // remains rejected — only codes are trusted.
    discount_code: z.string().trim().min(1).max(50).optional(),
    tax_amount: z.coerce.number().nonnegative().prefault(0),
    // B3.5 (Δ-39): tax_basis and gift_wrapping_fee are RPC params with
    // sensible defaults (exclusive / 0). The Zod schema mirrors the
    // RPC defaults so legacy callers that omit them keep working;
    // VAT-aware callers (calculateCommerce-driven storefront) send
    // both explicitly. `expected_total` and `client_total` carry the
    // client's locally-computed total — the API checks parity against
    // the server-recomputed `orders.total` and rejects mismatches.
    tax_basis: z.enum(['exclusive', 'inclusive']).default('exclusive'),
    gift_wrapping_fee: z.coerce.number().nonnegative().prefault(0),
    // Use a non-coercing schema for parity-check fields. `z.coerce` runs
    // `Number(value)`, and `Number(null)` is `0` — so a client sending
    // `expected_total: null` would silently become `0`, and the RPC's
    // parity check would compare server total to 0 → guaranteed
    // `order_total_mismatch` 400 even though the client just meant
    // "no expected total". `.nullable()` keeps null distinct from
    // missing, and the API treats both as "skip the parity check".
    expected_total: z.number().nonnegative().nullable().optional(),
    client_total: z.number().nonnegative().nullable().optional(),
    payment_method: z
      .string()
      .min(1)
      .transform((val) => sanitizeText(val)),
    payment_status: z.string().default('unpaid'),
    shipping_status: z.string().default('pending'),
    shipping_address: orderShippingAddressSchema.optional(),
    source: z
      .string()
      .default('online_store')
      .transform((val) => sanitizeText(val)),
    notes: z
      .string()
      .optional()
      .transform((val) => (val ? sanitizeText(val) : val)),
    ad_tracking: z
      .looseObject({
        fbp: z.string().optional(),
        fbc: z.string().optional(),
        userIp: z.string().optional(),
        userAgent: z.string().optional(),
        limitedDataUse: z.boolean().optional(),
      })
      .optional(),
    use_wallet_credit: z.boolean().default(false),
    wallet_amount: z.number().default(0),
    use_savings_credit: z.boolean().default(false),
    savings_goal_id: z.uuid().optional(),
    savings_amount: z.number().positive().optional(),
    user_id: z.uuid().optional(),
    // Merchant-configured shipping rate (merchant_shipping_rates.id). Sent by
    // checkout when the shopper picks a merchant rate (an `mrate_` quote).
    // The orders route re-verifies the rate against the merchant's zone
    // config + delivery destination and recomputes the fee server-side
    // (verifyOrderShippingRate) — the client `shipping_fee` is never trusted
    // for these orders. Nullable like selected_quote_id so clients can send
    // an explicit null for "no merchant rate selected".
    shipping_rate_id: z.uuid().nullable().optional(),
    // B3 review fix: mirror reuseCheckoutOrderSchema.shipping_provider —
    // sanitize at the validation boundary so both order-create AND
    // order-reuse paths persist the same normalized provider string.
    // Pre-fix, orderCreateSchemaBase accepted raw client input; the
    // legacy `shipping_provider_legacy` field already had the transform.
    shipping_provider: z
      .string()
      .nullable()
      .optional()
      .transform((val) => (val ? sanitizeText(val) : val)),
    tracking_number: z.string().optional(),
    // Legacy/Optional fields
    shipping_provider_legacy: z
      .string()
      .optional()
      .transform((val) => (val ? sanitizeText(val) : val)),
  })
  .and(orderDeliveryMetadataSchema)
  .superRefine((data, ctx) => {
    if (!data.use_savings_credit) {
      return;
    }

    if (!data.savings_goal_id) {
      ctx.addIssue({
        code: 'custom',
        message: 'Savings goal id is required when using savings credit',
        path: ['savings_goal_id'],
      });
    }

    if (data.savings_amount == null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Savings amount is required when using savings credit',
        path: ['savings_amount'],
      });
    }
  });

export const orderCreateSchema = z.preprocess((input) => {
  if (!input || typeof input !== 'object') {
    return input;
  }

  const data = input as Record<string, unknown>;

  return {
    ...data,
    selected_quote_id: data.selected_quote_id ?? data.shipping_quote_id,
  };
}, orderCreateSchemaBase);

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
