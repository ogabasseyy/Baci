import { z } from 'zod';
import type { PendingCheckoutOrderSnapshot } from './pending-checkout-order';

const kobo = z.number().int().nonnegative().safe();
const reviewSchema = z.object({
  ready: z.object({
    cartId: z.string().min(1).optional(),
    orderId: z.string().min(1),
    orderNumber: z.string().optional(),
    trackingToken: z.string().min(1),
    customerEmail: z.email(),
    customerName: z.string().min(1),
    customerPhone: z.string().min(1),
    checkoutFingerprint: z.string().startsWith('uba_redvault:'),
    billingAddress: z.object({
      line1: z.string().min(1),
      city: z.string().min(1),
      state: z.string().optional(),
      country: z.string().length(2),
      zip_code: z.string().optional(),
    }),
    currency: z.literal('NGN'),
    total: z.number().positive().finite(),
  }),
  summary: z.object({
    productSubtotalKobo: kobo,
    eligibleSubtotalKobo: kobo,
    ineligibleSubtotalKobo: kobo,
    discountKobo: kobo,
    assuranceFeeKobo: kobo,
    taxKobo: kobo,
    shippingKobo: kobo,
    giftWrappingKobo: kobo,
    payableKobo: kobo.positive(),
    mixedBasket: z.boolean(),
  }),
});

/** Browser storage restores presentation only; payment still verifies the order on the server. */
export function readRedvaultReviewRecovery(
  pending: PendingCheckoutOrderSnapshot | null,
  merchantId: string | undefined
) {
  if (
    !pending ||
    !merchantId ||
    pending.merchantId !== merchantId ||
    pending.paymentMethod !== 'uba_redvault'
  )
    return null;
  const parsed = reviewSchema.safeParse(pending.redvaultReview);
  if (!parsed.success) return null;
  const { ready, summary } = parsed.data;
  if (
    ready.orderId !== pending.orderId ||
    ready.trackingToken !== pending.trackingToken ||
    ready.customerEmail !== pending.customerEmail ||
    ready.customerPhone !== pending.customerPhone ||
    ready.checkoutFingerprint !== pending.checkoutFingerprint ||
    Math.round(ready.total * 100) !== summary.payableKobo ||
    Math.round(pending.amountDueToGateway * 100) !== summary.payableKobo
  )
    return null;
  try {
    const fingerprint: unknown = JSON.parse(
      ready.checkoutFingerprint.slice('uba_redvault:'.length)
    );
    if (
      !fingerprint ||
      typeof fingerprint !== 'object' ||
      Array.isArray(fingerprint)
    )
      return null;
    const fields = fingerprint as Record<string, unknown>;
    if (
      fields.merchantId !== merchantId ||
      fields.customerEmail !== ready.customerEmail.trim().toLowerCase() ||
      !Array.isArray(fields.items) ||
      fields.items.length === 0
    )
      return null;
  } catch {
    return null;
  }
  return parsed.data;
}
