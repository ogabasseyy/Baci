import { z } from 'zod';
import { formatPersonName } from '@/lib/format-person-name';
import {
  sanitizeEmail,
  sanitizePhone,
  sanitizeText,
  sanitizeUrl,
} from '@/lib/sanitize-core';
import { orderDeliveryMetadataSchema } from './checkout-delivery-metadata';

const optionalHttpUrlSchema = z.preprocess(
  (value) => {
    // Normalize null → undefined so clients that serialize optional fields
    // as `null` don't hit the URL validator (which would reject them).
    if (value === null) {
      return undefined;
    }

    if (typeof value !== 'string') {
      return value;
    }

    const trimmedValue = value.trim();

    return trimmedValue === '' ? undefined : trimmedValue;
  },
  z
    .url({
      error: 'Invalid URL',
    })
    .max(2048)
    .refine(
      (value) => {
        const protocol = new URL(value).protocol;

        return protocol === 'http:' || protocol === 'https:';
      },
      {
        error: 'URL must use http or https',
      }
    )
    .transform((value) => sanitizeUrl(value))
    .refine((value) => value.length > 0, {
      error: 'Invalid URL',
    })
    .optional()
);

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
    shipping_address: z
      .object({
        address: z
          .string()
          .min(1)
          .transform((val) => sanitizeText(val)),
        city: z
          .string()
          .optional()
          .transform((val) => (val ? sanitizeText(val) : val)),
        state: z
          .string()
          .optional()
          .transform((val) => (val ? sanitizeText(val) : val)),
        country: z
          .string()
          .optional()
          .transform((val) => (val ? sanitizeText(val) : val)),
        countryCode: z
          .string()
          .optional()
          .transform((val) => (val ? sanitizeText(val) : val)),
        postalCode: z
          .string()
          .optional()
          .transform((val) => (val ? sanitizeText(val) : val)),
      })
      .optional(),
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

export const reuseCheckoutOrderSchema = z.object({
  order_id: z.uuid(),
  merchant_id: z.uuid(),
  tracking_token: z.preprocess(
    (value) => (typeof value === 'string' ? sanitizeText(value, 128) : value),
    z.string().min(1)
  ),
  customer_email: z.preprocess(
    (value) => (typeof value === 'string' ? sanitizeEmail(value) : value),
    z.email()
  ),
  payment_method: z.preprocess(
    (value) => (typeof value === 'string' ? sanitizeText(value) : value),
    z.string().min(1)
  ),
  // B3 (plan §5 B3): accept null so pickup/airport reuse flows can
  // signal "no third-party shipping provider" cleanly.
  selected_quote_id: z.uuid().nullable().optional(),
  // Merchant-configured shipping rate (merchant_shipping_rates.id). Forwarded
  // when reopening a merchant-rate pending order whose original post-create
  // provider stamp failed, so the reuse route can re-stamp the fulfillment
  // provider + rate name (R14-3 — the reuse-path analogue of the orders POST
  // R9-5 re-stamp). This is the BARE rate uuid; the synthetic `mrate_`-prefixed
  // selected_quote_id stays nulled for merchant rates. Nullable like
  // selected_quote_id so clients can send an explicit null.
  shipping_rate_id: z.uuid().nullable().optional(),
  shipping_provider: z
    .string()
    .nullable()
    .optional()
    .transform((val) => (val ? sanitizeText(val) : val)),
});

export type ReuseCheckoutOrderInput = z.infer<typeof reuseCheckoutOrderSchema>;

export const orderIdParamsSchema = z.object({
  id: z.uuid(),
});

export const orderUpdateSchema = z
  .strictObject({
    // Transitional compatibility for deployed mobile clients. Authorization
    // remains derived from the authenticated user; this value is ignored.
    merchant_id: z.uuid(),
    payment_status: z.enum([
      'paid',
      'unpaid',
      'pending',
      'failed',
      'refunded',
      'partially_paid',
      'bnpl_approved',
      'bnpl_pending',
    ]),
    shipping_status: z.enum([
      'pending',
      'processing',
      'shipped',
      'out_for_delivery',
      'delivered',
      'completed',
      'cancelled',
      'canceled',
      'returned',
      'failed',
    ]),
    notes: z.string().nullable(),
    shipping_address: z.record(z.string(), z.unknown()).nullable(),
  })
  .partial();

export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;

export const merchantOrderCancellationSchema = z.strictObject({
  cancelled_by: z.literal('merchant').optional(),
  confirm_cancellation: z.literal(true),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) =>
      value ? sanitizeText(value, 500).trim() || undefined : undefined
    ),
});

const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  payment_method: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((val) => sanitizeText(val ?? 'manual', 50)),
  reference: z
    .string()
    .optional()
    .transform((val) => (val ? sanitizeText(val, 100) : val)),
  notes: z
    .string()
    .optional()
    .transform((val) => (val ? sanitizeText(val, 500) : val)),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
