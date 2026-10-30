import { z } from 'zod';

const kobo = z.number().int().nonnegative().safe();

export const redvaultReviewRecoverySchema = z.object({
  recoveryFence: z
    .object({
      merchantSlug: z.string().nullable(),
      epoch: z.string().nullable(),
    })
    .optional(),
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
