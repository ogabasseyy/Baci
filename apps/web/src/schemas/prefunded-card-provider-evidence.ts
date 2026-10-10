import { z } from 'zod';
import { piggyvestStagingConfigurationSchema } from './piggyvest-staging-configuration';
import { prefundedCardClaimedRequestSchema } from './prefunded-card-claimed-request';

const identifier = z.string().min(1).max(512).regex(/^\S+$/);
const optionalReference = z.string().max(512).nullable().optional();
const amount = z.number().int().positive().safe();
const evidence = z.strictObject({
  reference: identifier,
  amountKobo: amount,
  currency: z.literal('NGN'),
  businessId: identifier,
  sourceWalletId: identifier,
  destinationWalletId: identifier,
  destinationCustomerId: identifier,
  providerTransactionId: identifier,
});
const verification = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('verified_success'),
    evidence,
    request: prefundedCardClaimedRequestSchema,
  }),
  z.strictObject({ outcome: z.literal('deferred') }),
  z.strictObject({ outcome: z.literal('reconciliation_required') }),
]);

export const prefundedCardProviderEvidenceSchemas = {
  identifier,
  configuration: z.strictObject({
    integrationId: z.uuid(),
    systemIdentifier: z.string().regex(/^[0-9]{1,20}$/),
    webhookSecret: z.string().min(1),
    piggyvest: piggyvestStagingConfigurationSchema,
  }),
  envelope: z.object({
    eventId: identifier,
    eventType: identifier,
    eventCategory: identifier,
    customer_id: identifier,
    pvb_reference: identifier.optional(),
    pvb_wallet: identifier.optional(),
    pvb_destination_wallet: optionalReference,
    pvb_third_party_reference: optionalReference,
    eventData: z.record(z.string(), z.unknown()),
  }),
  bank: z
    .object({
      id: identifier,
      transaction_id: identifier,
      reference: identifier,
      customer_id: identifier,
      source_wallet_id: z.literal('').optional(),
      destination_wallet_id: identifier,
      type: z.enum(['inflow', 'inter']),
      category: z.literal('bank_transfer_inflow'),
      status: z.enum(['success', 'COMPLETED']),
      amount,
      fee: z.literal(0),
      currency: z.literal('NGN'),
      session_id: identifier.nullable().optional(),
      timestamp: z.iso.datetime({ offset: true }).optional(),
      third_party_reference: optionalReference,
      initiator_reference: optionalReference,
      internal_reference: optionalReference,
    })
    .superRefine((bank, context) => {
      if (
        (bank.type === 'inflow' &&
          (bank.status !== 'success' || bank.source_wallet_id !== '')) ||
        (bank.type === 'inter' && bank.status !== 'COMPLETED')
      )
        context.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'Unrecognized completed bank inflow shape',
        });
    }),
  single: z.object({
    status: z.literal(true),
    data: z
      .object({
        id: identifier,
        customer_id: identifier,
        source_wallet: z.string().max(512),
        destination_wallet: z.union([identifier, z.literal('')]),
        reference: identifier,
        third_party_reference: optionalReference,
        internal_reference: optionalReference,
        session_id: optionalReference,
        category: identifier,
        status: z.enum(['pending', 'successful', 'failed', 'partial']),
        amount,
        fee: z.number().int().nonnegative().safe(),
      })
      .superRefine((single, context) => {
        if (
          single.destination_wallet === '' &&
          (single.category !== 'bank-inflow' ||
            !identifier.safeParse(single.source_wallet).success)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['destination_wallet'],
            message: 'Empty destination requires a bank-inflow wallet summary',
          });
        }
      }),
  }),
  tsq: z.object({
    status: z.literal(true),
    data: z.object({
      reference: identifier,
      status: z.enum(['success', 'pending', 'failed']),
      amount,
    }),
  }),
  wallets: z.object({
    status: z.literal(true),
    data: z.object({
      paginatedPayload: z.object({
        edges: z
          .array(
            z.object({
              id: identifier,
              business_id: identifier,
              api_customer_id: identifier.nullish(),
              currency: z.literal('NGN'),
            })
          )
          .max(100),
      }),
    }),
  }),
  destinationRows: z
    .array(
      z.strictObject({
        result: z
          .strictObject({
            providerWalletId: identifier,
            providerCustomerId: identifier,
          })
          .nullable(),
      })
    )
    .length(1),
  observation: z.strictObject({
    eventId: identifier,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    eventType: identifier,
    eventCategory: identifier,
    eventDataId: identifier.nullable(),
    envelopeWalletId: identifier.nullable(),
    sessionId: identifier.nullable(),
    creditedAt: z.iso.datetime({ offset: true }).nullable(),
    status: z.enum(['deferred', 'verified']),
    kind: z.enum(['unknown', 'internal_transfer', 'bank_inflow']),
    providerTransactionId: identifier.nullable(),
    destinationCustomerId: identifier,
    sourceWalletId: z.string().max(512).nullable(),
    destinationWalletId: identifier.nullable(),
    reference: identifier.nullable(),
    references: z.array(identifier).max(24),
    amountKobo: amount.nullable(),
    feeKobo: z.literal(0).nullable(),
    currency: z.literal('NGN').nullable(),
  }),
  scopeRows: z
    .array(
      z.strictObject({
        result: z.strictObject({
          businessId: identifier,
          currency: z.literal('NGN'),
        }),
      })
    )
    .length(1),
  recordRows: z
    .array(
      z.strictObject({
        result: z.enum(['stored', 'duplicate', 'conflict', 'deferred']),
      })
    )
    .length(1),
  applicationRows: z
    .array(
      z.strictObject({
        result: z.enum([
          'applied',
          'duplicate',
          'deferred',
          'reconciliation_required',
        ]),
      })
    )
    .length(1),
  verificationRows: z.array(z.strictObject({ result: verification })).length(1),
  classificationRows: z
    .array(
      z.strictObject({
        result: z.discriminatedUnion('outcome', [
          z.strictObject({
            outcome: z.literal('bank_inflow'),
            eventId: identifier,
            integrationId: z.uuid(),
            merchantId: z.uuid(),
            customerId: z.uuid(),
            goalId: z.uuid(),
            providerTransactionId: identifier,
            destinationWalletId: identifier,
            destinationCustomerId: identifier,
            reference: identifier,
            amountKobo: amount,
            feeKobo: z.literal(0),
            currency: z.literal('NGN'),
          }),
          z.strictObject({
            outcome: z.enum([
              'deferred',
              'reconciliation_required',
              'bridge_inflight',
              'bridge_duplicate',
            ]),
          }),
        ]),
      })
    )
    .length(1),
};
