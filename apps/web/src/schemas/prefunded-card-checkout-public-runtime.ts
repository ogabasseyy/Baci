import { z } from 'zod';
import { prefundedCardCheckoutCompositionSchema } from './prefunded-card-checkout-composition';
import { prefundedCardKnownDeadlineSchema } from './prefunded-card-known-deadline';
import { prefundedCardPublicRuntimeSchemas } from './prefunded-card-public-runtime';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const maximumAmountKobo = z.number().int().nonnegative().safe();

const capability = z
  .strictObject({
    goalId: uuid,
    enabled: z.boolean(),
    maximumAmountKobo,
    currency: z.literal('NGN'),
  })
  .refine((value) => !value.enabled || value.maximumAmountKobo > 0);

const capabilitySelection = z.strictObject({ goalId: uuid });

const state = z
  .strictObject({
    intentId: uuid,
    goalId: uuid,
    amountKobo: z.number().int().positive().safe(),
    currency: z.literal('NGN'),
    status: z.enum([
      'reserved',
      'initializing',
      'ready',
      'pending',
      'reconciliation_required',
      'funding_pending',
      'completed',
      'retired_unconfirmed',
    ]),
    authorizationUrl: z
      .string()
      .max(512)
      .regex(/^https:\/\/checkout\.paystack\.com\/[A-Za-z0-9]+$/)
      .optional(),
  })
  .superRefine((value, context) => {
    if ((value.status === 'ready') !== Boolean(value.authorizationUrl)) {
      context.addIssue({
        code: 'custom',
        message: 'Invalid first-card checkout state',
      });
    }
  });

const configuration = z
  .strictObject({
    deployment: z.literal('staging'),
    expiresAt: prefundedCardKnownDeadlineSchema,
    publicOrigin: z.literal('https://staging.ogabassey.com'),
    authOrigin: z.literal('https://staging-auth.ogabassey.com'),
    maximumAmountKobo,
    context: prefundedCardPublicRuntimeSchemas.context,
    checkout: prefundedCardCheckoutCompositionSchema,
  })
  .superRefine((value, context) => {
    const { checkout } = value;
    const { scope } = checkout;
    const customerDatabase = checkout.customerDatabase;
    const matchesContextProject =
      customerDatabase.transport === 'tls' &&
      value.context.expectedProjectId === customerDatabase.expectedProjectId &&
      value.context.actualProjectId === customerDatabase.actualProjectId;
    if (
      scope.deployment !== value.deployment ||
      scope.expiresAt !== value.expiresAt ||
      value.context.integrationId !== scope.integrationId ||
      value.context.merchantId !== scope.merchantId ||
      value.context.expectedBusinessId !== scope.businessId ||
      !matchesContextProject
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Invalid public first-card checkout runtime',
      });
    }
  });

export const prefundedCardCheckoutPublicSchemas = {
  capability,
  capabilitySelection,
  configuration,
  state,
};
