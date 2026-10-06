import { z } from 'zod';

const requestId = z.uuid().transform((value) => value.toLowerCase());
const request = z.strictObject({ goalId: requestId, offerId: requestId });
const receipt = z
  .strictObject({
    offerId: z.uuid(),
    goalId: z.uuid(),
    revisionId: z.uuid(),
    device: z.strictObject({
      productId: z.uuid(),
      variantId: z.uuid().nullable(),
      condition: z.string().min(1).max(100),
    }),
    priceKobo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    termsVersion: z.string().min(1).max(100),
    termsHash: z.string().regex(/^[a-f0-9]{64}$/),
    startsAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    scope: z.literal('device_price_only'),
    purchase: z.literal('requires_confirmation'),
    dispatch: z.literal('disabled'),
  })
  .refine(
    (value) =>
      Date.parse(value.expiresAt) - Date.parse(value.startsAt) ===
      168 * 60 * 60 * 1000
  );
const observation = z.strictObject({
  status: z.literal('observed'),
  requestedOfferId: z.uuid(),
  receipt,
  observedAt: z.iso.datetime(),
  pricePromise: z.enum(['active', 'expired', 'historical']),
  funds: z.literal('requires_checkout_review'),
});
export const piggyvestProtectedOfferSchemas = {
  request,
  receipt,
  observation,
  published: z.strictObject({ status: z.literal('published'), receipt }),
  rows: z.array(z.strictObject({ result: receipt })).length(1),
  observationRows: z.array(z.strictObject({ result: observation })).length(1),
};
