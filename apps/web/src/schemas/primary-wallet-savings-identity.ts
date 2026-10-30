import { z } from 'zod';
import { prefundedCardTransferVerificationSchemas } from './prefunded-card-transfer-verification';

const identifier = prefundedCardTransferVerificationSchemas.identifier;
const wallet = z.object({
  id: identifier,
  business_id: identifier,
  api_customer_id: identifier,
  currency: z.literal('NGN'),
  status: z.literal('active'),
  is_frozen: z.literal(false),
});
const transaction = z.object({
  id: identifier,
  business_id: identifier,
  wallet_id: identifier,
  api_customer_id: identifier,
  currency: z.literal('NGN'),
  type: z.literal('debit'),
  category: z.literal('p2p'),
  status: z.literal('successful'),
  amount: z.number().int().negative().safe(),
  charge: z.literal(0),
  third_party_reference: identifier,
  provider_reference: identifier,
});
const page = z
  .object({
    edges: z.array(z.looseObject({ id: identifier })).max(100),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: identifier.nullable(),
    }),
  })
  .refine(
    (value) => !value.pageInfo.hasNextPage || value.pageInfo.endCursor !== null
  );
// The provider's single-transaction envelope includes additional fields. Keep
// the settlement proof's allowlist, while stripping unrelated response data.
const singleTransaction = z.object({
  id: identifier,
  customer_id: identifier,
  source_wallet: identifier,
  destination_wallet: identifier,
  status: z.literal('successful'),
  amount: z.number().int().positive().safe(),
  fee: z.number().int().nonnegative().safe(),
  reference: identifier,
  third_party_reference: identifier.nullable().optional(),
  internal_reference: identifier.nullable().optional(),
});
const productionSingleTransaction = singleTransaction.extend({
  status: z.enum(['successful', 'failed']),
  category: z.literal('p2p'),
});
const evidence = z.discriminatedUnion('environment', [
  z.strictObject({
    environment: z.literal('production'),
    wallet,
    transaction: productionSingleTransaction,
  }),
  z.strictObject({
    environment: z.literal('staging'),
    wallet,
    transaction: singleTransaction,
  }),
]);

export const primaryWalletSavingsIdentitySchemas = {
  wallet,
  page,
  transaction,
  singleTransaction,
  productionSingleTransaction,
  evidence,
};
