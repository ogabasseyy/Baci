import { z } from 'zod';
import { primaryWalletCardCustodySchemas as custody } from './primary-wallet-card-custody';

const runtime = custody.runtime
  .omit({ custody: true, webhookSecret: true })
  .extend({
    transferOnly: z.literal(true),
    transfer: custody.runtime.shape.transfer.unwrap(),
  });
export const primaryCardTransferProviderSchemas = {
  runtime,
  configuration: z.strictObject({
    runtime,
    policyBytes: z.string().min(1).max(8192),
    policySignature: z.string().regex(/^[a-f0-9]{64}$/),
    policyIssuerKey: z.string().min(32).max(4096),
  }),
  policy: z.strictObject({
    authority: z.literal('approved_reusable_primary_card_transfer_contract'),
    integrationId: z.uuid(),
    merchantId: z.uuid(),
    businessId: custody.context.shape.businessId,
    environment: custody.context.shape.environment,
    contractId: custody.runtime.shape.crosswalkAuthority.shape.contractId,
    evidenceIssuer:
      custody.runtime.shape.crosswalkAuthority.shape.evidenceIssuer,
    treasuryWebhookCustomerId:
      custody.runtime.shape.crosswalkAuthority.shape.treasuryWebhookCustomerId,
    transactionCustomerId:
      custody.runtime.shape.crosswalkAuthority.shape.transactionCustomerId,
    evidenceSha256: custody.crosswalk.shape.evidenceSha256,
    observedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    transferEnabled: z.literal(true),
    reusableBindingReady: z.literal(true),
    exhaustiveAliasContractApproved: z.literal(true),
  }),
  accepted: z.object({ status: z.literal(true) }),
};
