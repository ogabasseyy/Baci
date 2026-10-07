import { z } from 'zod';
import { piggyvestPolicyTextByteLength } from './piggyvest-policy-text-byte-length';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.iso.datetime({ offset: true });
const quote = z.strictObject({
  quoteId: uuid,
  revisionId: uuid,
  priorRevisionId: uuid,
  goalId: uuid,
  device: z.strictObject({
    productId: uuid,
    variantId: uuid.nullable(),
    productName: z.string().trim().min(1).max(200),
    variant: z.string().trim().min(1).max(200).nullable(),
    condition: z.string().trim().min(1).max(100),
  }),
  priceKobo: z.number().int().safe().positive(),
  durationMonths: z.number().int().min(1).max(6).nullable(),
  termsVersion: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  termsHash: z.string().regex(/^[0-9a-f]{64}$/),
  maturesAt: timestamp.nullable(),
  graceExpiresAt: timestamp.nullable(),
  expiresAt: timestamp,
});
const terms = z.strictObject({
  version: quote.shape.termsVersion,
  hash: quote.shape.termsHash,
  text: z
    .string()
    .min(1)
    .max(32768)
    .refine(
      (text) =>
        text.trim().length > 0 && piggyvestPolicyTextByteLength(text) <= 32768
    ),
});
const receipt = quote.omit({ expiresAt: true }).extend({
  status: z.literal('device_changed'),
  operationId: uuid,
  wallet: z.literal('unchanged'),
  balances: z.literal('unchanged'),
  collection: z.literal('paused'),
  dispatch: z.literal('disabled'),
});
export const piggyvestDeviceChangeSchemas = {
  selection: z.strictObject({
    goalId: uuid,
    quoteId: uuid,
    productId: uuid,
    variantId: uuid.nullable(),
  }),
  confirmation: z.strictObject({
    goalId: uuid,
    operationId: uuid,
    accepted: z.literal(true),
    quote,
  }),
  lookup: z.strictObject({ goalId: uuid, operationId: uuid }),
  quote,
  receipt,
  terms,
  published: z
    .strictObject({ status: z.literal('quote_available'), quote, terms })
    .refine(
      (value) =>
        value.quote.termsHash === value.terms.hash &&
        value.quote.termsVersion === value.terms.version
    ),
  historical: z.strictObject({ status: z.literal('historical'), receipt }),
};
