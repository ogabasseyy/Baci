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

export const primaryWalletSavingsIdentitySchemas = {
  wallet,
  page,
  transaction,
  evidence: z.strictObject({ wallet, transaction }),
};
