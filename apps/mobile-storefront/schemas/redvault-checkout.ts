import { z } from 'zod';

const kobo = z.number().int().nonnegative().safe();

export const RedvaultCheckoutSchema = z
  .object({
    order: z.object({
      id: z.uuid(),
      total: z.number().finite().nonnegative(),
      currency: z.literal('NGN'),
      tracking_token: z.string().nullable(),
      payment_method: z.literal('uba_redvault'),
      payment_status: z.literal('unpaid'),
    }),
    redvault: z.object({
      status: z.literal('pending'),
      quote: z.object({
        product_subtotal_kobo: kobo,
        eligible_subtotal_kobo: kobo,
        ineligible_subtotal_kobo: kobo,
        discount_kobo: kobo,
        assurance_fee_kobo: kobo,
        tax_kobo: kobo,
        shipping_kobo: kobo,
        gift_wrapping_kobo: kobo,
        payable_kobo: kobo,
        mixed_basket: z.boolean(),
      }),
    }),
  })
  .refine(
    ({ order, redvault: { quote } }) =>
      Math.abs(order.total * 100 - quote.payable_kobo) < 0.000001 &&
      quote.product_subtotal_kobo ===
        quote.eligible_subtotal_kobo + quote.ineligible_subtotal_kobo &&
      quote.discount_kobo <= quote.eligible_subtotal_kobo &&
      quote.payable_kobo ===
        quote.product_subtotal_kobo -
          quote.discount_kobo +
          quote.assurance_fee_kobo +
          quote.tax_kobo +
          quote.shipping_kobo +
          quote.gift_wrapping_kobo &&
      quote.mixed_basket === quote.ineligible_subtotal_kobo > 0,
    'Invalid persisted REDVAULT summary'
  );

export type RedvaultCheckout = z.infer<typeof RedvaultCheckoutSchema>;
