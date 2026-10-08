import { z } from 'zod';

const uuid = z.uuid();
const environment = z.enum(['staging', 'production']);
const identifier = z.string().min(1).max(512).regex(/^\S+$/);
const reference = z.string().regex(/^pvb-first-primary-[0-9a-f-]{36}$/);
const scope = z.strictObject({
  environment,
  integrationId: uuid,
  merchantId: uuid,
  customerId: uuid,
  userId: uuid,
  businessId: identifier,
  email: z.email().max(254),
});
const request = z.strictObject({
  merchantId: uuid,
  idempotencyKey: uuid,
  amountKobo: z.number().int().positive().max(9999999999),
  consent: z.strictObject({
    version: z.literal('primary-wallet-card-v1'),
    oneTimeCharge: z.literal(true),
    saveCard: z.boolean(),
  }),
});
const session = z.strictObject({
  reference,
  authorizationUrl: z
    .string()
    .max(512)
    .regex(/^https:\/\/checkout\.paystack\.com\/[A-Za-z0-9]+$/),
});
const intent = scope
  .extend({
    operationId: uuid,
    amountKobo: request.shape.amountKobo,
    consent: request.shape.consent,
    reference,
    destinationWalletId: identifier,
    destinationCustomerId: identifier,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum([
      'reserved',
      'initializing',
      'init_unknown',
      'ready',
      'custody_pending',
      'reconciliation_required',
      'completed',
    ]),
    authorizationUrl: session.shape.authorizationUrl.nullable(),
  })
  .refine(
    (value) => value.reference === `pvb-first-primary-${value.operationId}`
  );
const token = z.strictObject({
  authorizationCode: z
    .string()
    .max(512)
    .regex(/^AUTH_[A-Za-z0-9_]+$/),
  customerCode: z
    .string()
    .max(512)
    .regex(/^CUS_[A-Za-z0-9_]+$/),
  email: z.email().max(254),
  reusable: z.literal(true),
});

export const primaryWalletCardCheckoutSchemas = {
  scope,
  request,
  session,
  intent,
  token,
  identity: z.strictObject({
    id: uuid,
    merchant_id: uuid,
    user_id: uuid,
    email: z.email(),
  }),
  statusRequest: z.strictObject({ merchantId: uuid, operationId: uuid }),
  settings: z
    .strictObject({
      environment,
      integrationId: uuid,
      merchantId: uuid,
      businessId: identifier,
      expiresAt: z.iso.datetime({ offset: true }),
      callbackUrl: z
        .url()
        .max(512)
        .refine((value) => {
          try {
            const url = new URL(value);
            return (
              url.protocol === 'https:' &&
              !url.username &&
              !url.password &&
              !url.hash &&
              !url.search
            );
          } catch {
            return false;
          }
        }),
      paystackSecret: z.string().regex(/^sk_(test|live)_[A-Za-z0-9]+$/),
    })
    .refine((value) =>
      value.paystackSecret.startsWith(
        value.environment === 'production' ? 'sk_live_' : 'sk_test_'
      )
    ),
  claim: z.discriminatedUnion('outcome', [
    z.strictObject({ outcome: z.literal('claimed'), token: uuid, intent }),
    z.strictObject({ outcome: z.literal('existing'), intent }),
  ]),
  collection: z.strictObject({
    providerTransactionId: z
      .string()
      .regex(/^[1-9][0-9]{0,19}$/)
      .refine((value) => BigInt(value) <= 18446744073709551615n),
    amountKobo: request.shape.amountKobo,
    reference,
    domain: z.enum(['test', 'live']),
    token: token.nullable(),
  }),
  acknowledgement: z.literal(true),
  initializationAcknowledgement: z.boolean(),
};
