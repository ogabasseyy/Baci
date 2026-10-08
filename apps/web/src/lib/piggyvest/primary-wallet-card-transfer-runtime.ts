import 'server-only';
import { primaryCardTransferProviderSchemas as schemas } from '@/schemas/primary-wallet-card-transfer-provider';
import { assertPrimaryCardTransferPolicy } from './primary-wallet-card-transfer-policy';

export function readPrimaryCardTransferRuntime(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now()
) {
  if (
    env.PIGGYVEST_PRIMARY_CARD_TRANSFER_PROVIDER_ENABLED !== 'true' ||
    env.PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED !== 'true' ||
    env.PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED !== 'true' ||
    env.PIGGYVEST_PRIMARY_CARD_CUSTODY_PASSWORD ||
    env.PIGGYVEST_PRIMARY_CARD_INTAKE_PASSWORD ||
    (env.VERCEL_ENV === 'production') !==
      (env.PIGGYVEST_PRIMARY_CARD_ENVIRONMENT === 'production')
  )
    return null;
  const parsed = schemas.configuration.safeParse({
    runtime: {
      transferOnly: true,
      integrationId: env.PIGGYVEST_PRIMARY_CARD_INTEGRATION_ID,
      merchantId: env.PIGGYVEST_PRIMARY_CARD_MERCHANT_ID,
      businessId: env.PIGGYVEST_PRIMARY_CARD_BUSINESS_ID,
      environment: env.PIGGYVEST_PRIMARY_CARD_ENVIRONMENT,
      expiresAt: env.PIGGYVEST_PRIMARY_CARD_EXPIRES_AT,
      apiToken: env.PIGGYVEST_PRIMARY_CARD_PIGGYVEST_TOKEN,
      crosswalkAuthority: {
        contractId: env.PIGGYVEST_PRIMARY_CARD_CROSSWALK_CONTRACT_ID,
        evidenceIssuer: env.PIGGYVEST_PRIMARY_CARD_CROSSWALK_ISSUER,
        treasuryWebhookCustomerId:
          env.PIGGYVEST_PRIMARY_CARD_TREASURY_WEBHOOK_CUSTOMER_ID,
        transactionCustomerId:
          env.PIGGYVEST_PRIMARY_CARD_TRANSACTION_CUSTOMER_ID,
      },
      transfer: {
        login: 'baci_primary_card_transfer',
        host: env.PIGGYVEST_PRIMARY_CARD_DB_HOST,
        port: Number(env.PIGGYVEST_PRIMARY_CARD_DB_PORT),
        name: env.PIGGYVEST_PRIMARY_CARD_DB_NAME,
        certificateAuthority: env.PIGGYVEST_PRIMARY_CARD_DB_CA,
        password: env.PIGGYVEST_PRIMARY_CARD_TRANSFER_PASSWORD,
      },
    },
    policyBytes: env.PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_BYTES,
    policySignature: env.PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_SIGNATURE,
    policyIssuerKey: env.PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_ISSUER_KEY,
  });
  if (!parsed.success) return null;
  try {
    return assertPrimaryCardTransferPolicy(parsed.data, now);
  } catch {
    return null;
  }
}
