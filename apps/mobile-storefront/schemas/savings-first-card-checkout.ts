import { z } from 'zod';

const uuid = z.string().uuid();
const kobo = z.number().int().safe().positive();
const status = z.enum([
  'reserved',
  'initializing',
  'ready',
  'pending',
  'reconciliation_required',
  'funding_pending',
  'completed',
  'retired_unconfirmed',
]);
const authorizationUrl = z
  .string()
  .max(512)
  .regex(/^https:\/\/checkout\.paystack\.com\/[A-Za-z0-9]+$/);

export const SavingsFirstCardCheckoutSchemas = {
  capability: z.strictObject({
    goalId: uuid,
    enabled: z.boolean(),
    maximumAmountKobo: z.number().int().safe().nonnegative(),
    currency: z.literal('NGN'),
  }),
  consent: z.strictObject({
    version: z.literal('prefunded-first-card-v1'),
    oneTimeCharge: z.literal(true),
    saveCard: z.literal(true),
  }),
  request: z.strictObject({
    goalId: uuid,
    amountKobo: kobo,
    idempotencyKey: uuid,
    consent: z.strictObject({
      version: z.literal('prefunded-first-card-v1'),
      oneTimeCharge: z.literal(true),
      saveCard: z.literal(true),
    }),
  }),
  selection: z.strictObject({ intentId: uuid, goalId: uuid }),
  publicState: z
    .strictObject({
      intentId: uuid,
      goalId: uuid,
      amountKobo: kobo,
      currency: z.literal('NGN'),
      status,
      authorizationUrl: authorizationUrl.optional(),
    })
    .superRefine((value, context) => {
      if ((value.status === 'ready') !== Boolean(value.authorizationUrl))
        context.addIssue({
          code: 'custom',
          message: 'Checkout URL state mismatch',
        });
    }),
  authorizationUrl,
};

export const SavingsFirstCardCheckoutSnapshotSchema =
  SavingsFirstCardCheckoutSchemas.request
    .extend({
      intentId:
        SavingsFirstCardCheckoutSchemas.selection.shape.intentId.nullable(),
      status:
        SavingsFirstCardCheckoutSchemas.publicState.shape.status.optional(),
      authorizationUrl:
        SavingsFirstCardCheckoutSchemas.authorizationUrl.optional(),
    })
    .superRefine((value, context) => {
      if (
        value.status !== undefined &&
        (value.status === 'ready') !== Boolean(value.authorizationUrl)
      )
        context.addIssue({
          code: 'custom',
          message: 'Saved checkout URL state mismatch',
        });
    });

export type SavingsFirstCardCheckoutStatus = z.infer<
  typeof SavingsFirstCardCheckoutSchemas.publicState
>['status'];

export type SavingsFirstCardCheckoutRequest = z.infer<
  typeof SavingsFirstCardCheckoutSchemas.request
>;
