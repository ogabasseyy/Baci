import { z } from 'zod';
import { env } from '@/env';
import {
  generateOrderConfirmationEmail,
  generateOrderConfirmationText,
} from '@/lib/email-templates';
import type { StepExecutor } from '@/lib/payments/apply-paid-order-side-effects';
import {
  getFromName,
  mapOrderItemToEmailItem,
  PAID_ORDER_EMAIL_FALLBACK_ROOT_DOMAIN,
  resolveMerchantReplyTo,
  resolveMerchantUrl,
  SUPABASE_ROW_NOT_FOUND_CODE,
} from '@/lib/payments/paid-order-email-utils';
import type {
  MerchantDetails,
  RichPaidOrder,
} from '@/lib/payments/paid-order-side-effect-types';
import { toNumber } from '@/lib/payments/paid-order-side-effect-utils';
import { sendEmail } from '@/lib/zeptomail';

const nullableStringSchema = z.string().nullable();
const merchantDetailsSchema = z.strictObject({
  business_name: nullableStringSchema,
  cac_rc_number: nullableStringSchema,
  email: nullableStringSchema,
  email_sender_name: nullableStringSchema,
  slug: nullableStringSchema,
  support_email: nullableStringSchema,
  tax_identification_number: nullableStringSchema,
});

const richOrderEmailSchema = z.looseObject({
  currency: z.string().nullish(),
  customer_email: z.email().nullish(),
  customer_id: z.string().nullish(),
  customer_name: z.string().nullish(),
  customer_phone: z.string().nullish(),
  id: z.string().min(1),
  merchant_id: z.string().min(1),
  order_items: z
    .array(
      z.strictObject({
        condition: nullableStringSchema.optional(),
        id: nullableStringSchema.optional(),
        name: nullableStringSchema,
        price: z.union([z.number(), z.string(), z.null()]),
        product_id: nullableStringSchema.optional(),
        quantity: z.number().nullable(),
        variant_name: nullableStringSchema,
      })
    )
    .nullish(),
  order_number: z.string().nullish(),
  shipping_address: z
    .object({
      address: nullableStringSchema.optional(),
      city: nullableStringSchema.optional(),
      state: nullableStringSchema.optional(),
    })
    .nullish(),
  shipping_fee: z.union([z.number(), z.string()]),
  subtotal: z.union([z.number(), z.string()]),
  total: z.union([z.number(), z.string()]),
});

function validateMerchantDetails(merchantDetails: MerchantDetails) {
  const parsed = merchantDetailsSchema.safeParse(merchantDetails);
  if (!parsed.success) {
    throw new Error(
      `invalid_merchant_details_for_paid_email: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

function validateRichPaidOrder(order: RichPaidOrder) {
  const parsed = richOrderEmailSchema.safeParse(order);
  if (!parsed.success) {
    throw new Error(`invalid_order_for_paid_email: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function buildEmailExecutor({
  actor,
  emailMaxAttemptsPerSender,
  fallbackDeadlineMs,
  merchantDetails,
  merchantFetchError,
  order,
  signal,
}: {
  actor: string;
  emailMaxAttemptsPerSender?: number;
  fallbackDeadlineMs?: number;
  merchantDetails: MerchantDetails | null;
  merchantFetchError: { code?: string; message?: string } | null;
  order: RichPaidOrder;
  signal?: AbortSignal;
}): StepExecutor {
  return async () => {
    if (
      merchantFetchError &&
      merchantFetchError.code !== SUPABASE_ROW_NOT_FOUND_CODE
    ) {
      throw new Error(`merchant_fetch_error: ${merchantFetchError.message}`);
    }
    const validatedOrder = validateRichPaidOrder(order);
    if (!(merchantDetails && validatedOrder.customer_email)) {
      return { skipped: 'missing_merchant_or_customer_email' };
    }
    const validatedMerchantDetails = validateMerchantDetails(merchantDetails);

    const rootDomain =
      env.NEXT_PUBLIC_ROOT_DOMAIN || PAID_ORDER_EMAIL_FALLBACK_ROOT_DOMAIN;
    const emailItems = (validatedOrder.order_items ?? []).map(
      mapOrderItemToEmailItem
    );
    const shippingAddress = validatedOrder.shipping_address ?? {};
    const emailData = {
      currency: validatedOrder.currency || 'NGN',
      customerName: validatedOrder.customer_name ?? '',
      items: emailItems,
      merchantName: validatedMerchantDetails.business_name ?? '',
      merchantRcNumber: validatedMerchantDetails.cac_rc_number ?? undefined,
      merchantTin:
        validatedMerchantDetails.tax_identification_number ?? undefined,
      merchantUrl: resolveMerchantUrl({
        merchantDetails: validatedMerchantDetails,
        rootDomain,
      }),
      orderNumber:
        validatedOrder.order_number ||
        validatedOrder.id.slice(0, 8).toUpperCase(),
      shippingAddress: {
        address: shippingAddress.address ?? '',
        city: shippingAddress.city ?? '',
        phone: validatedOrder.customer_phone ?? '',
        state: shippingAddress.state ?? '',
      },
      shippingFee: toNumber(
        validatedOrder.shipping_fee ?? 0,
        'order shipping fee'
      ),
      subtotal: toNumber(validatedOrder.subtotal, 'order subtotal'),
      total: toNumber(validatedOrder.total, 'order total'),
    };
    if (signal?.aborted) {
      // The pass budget died before dispatch (slow finalizer DB ops
      // can consume the shared timeout): nothing was sent, so this
      // is a retryable definite non-send — not the indeterminate
      // outcome an abort after dispatch would be.
      throw new Error('paid_email_aborted_before_dispatch');
    }
    const result = await sendEmail({
      auditContext: {
        customerId: validatedOrder.customer_id ?? null,
        merchantId: validatedOrder.merchant_id,
        metadata: { trigger: actor },
        orderId: validatedOrder.id,
      },
      clientReference: `order:${validatedOrder.id}:paid_email`,
      emailType: 'orders',
      // Short passes cap the loop so the send fits their budget; unset
      // keeps the default four attempts and the next sweep retries.
      ...(emailMaxAttemptsPerSender !== undefined && {
        maxAttemptsPerSender: emailMaxAttemptsPerSender,
      }),
      fallbackDeadlineMs,
      fromName: getFromName(validatedMerchantDetails),
      htmlContent: generateOrderConfirmationEmail(emailData),
      replyTo: resolveMerchantReplyTo({
        merchantDetails: validatedMerchantDetails,
        rootDomain,
      }),
      signal,
      subject: `Order Confirmation - #${emailData.orderNumber}`,
      textContent: generateOrderConfirmationText(emailData),
      to: validatedOrder.customer_email,
      toName: validatedOrder.customer_name ?? undefined,
    });
    if (!result.success) {
      if (result.deliveryOutcome === 'unknown') {
        // The send may have reached ZeptoMail (e.g. the pass deadline
        // aborted it after dispatch): retrying could duplicate the order
        // confirmation, so persist the indeterminate outcome as terminal
        // instead of a retryable failure. The ZeptoMail audit trail
        // (client_reference order:<id>:paid_email) is the source of truth.
        return {
          delivery_uncertain: true,
          error: result.error || result.errorCode || 'email_failed',
        };
      }
      throw new Error(result.error || result.errorCode || 'email_failed');
    }
    return { messageId: result.messageId };
  };
}
