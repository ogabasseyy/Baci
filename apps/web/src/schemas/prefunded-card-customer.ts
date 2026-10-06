import { z } from 'zod';
import { containsAsciiControl } from '@/lib/contains-ascii-control';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const status = z.enum([
  'pending',
  'completed',
  'collection_failed',
  'reconciliation_required',
]);

export const prefundedCardCustomerSchemas = {
  actor: z.object({ id: uuid }),
  request: z.strictObject({
    goalId: uuid,
    savedMethodId: uuid,
    amountKobo: z.number().int().positive().safe(),
    idempotencyKey: uuid,
    consent: z.strictObject({
      version: z.literal('prefunded-card-v1'),
      oneTimeCharge: z.literal(true),
    }),
  }),
  selection: z.strictObject({ goalId: uuid, idempotencyKey: uuid.optional() }),
  capability: z
    .strictObject({
      goalId: uuid,
      enabled: z.boolean(),
      newCardEnabled: z.literal(false),
      currency: z.literal('NGN'),
      maximumAmountKobo: z.number().int().nonnegative().safe(),
      savedMethods: z
        .array(
          z.strictObject({
            id: uuid,
            brand: z
              .string()
              .trim()
              .min(1)
              .max(64)
              .refine((value) => !containsAsciiControl(value)),
            last4: z.string().regex(/^[0-9]{4}$/),
          })
        )
        .max(20),
    })
    .superRefine((value, context) => {
      if (
        new Set(value.savedMethods.map((method) => method.id)).size !==
          value.savedMethods.length ||
        (value.enabled &&
          (value.maximumAmountKobo === 0 || value.savedMethods.length === 0))
      )
        context.addIssue({
          code: 'custom',
          message: 'Invalid card capability',
        });
    }),
  configuration: z.strictObject({
    enabled: z.literal(true),
    expectedSystemId: z.string().regex(/^[0-9]{1,20}$/),
  }),
  result: z.strictObject({
    operationId: uuid,
    goalId: uuid,
    amountKobo: z.number().int().positive().safe(),
    currency: z.literal('NGN'),
    status,
  }),
};
