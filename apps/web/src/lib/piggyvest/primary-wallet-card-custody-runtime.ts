import 'server-only';
import { primaryWalletCardCustodySchemas as schemas } from '@/schemas/primary-wallet-card-custody';

export function readPrimaryCardCustodyRuntime(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now()
) {
  if (
    env.PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED !== 'true' ||
    (env.VERCEL_ENV === 'production') !==
      (env.PIGGYVEST_PRIMARY_CARD_ENVIRONMENT === 'production')
  )
    return null;
  const database = {
    host: env.PIGGYVEST_PRIMARY_CARD_DB_HOST,
    port: Number(env.PIGGYVEST_PRIMARY_CARD_DB_PORT),
    name: env.PIGGYVEST_PRIMARY_CARD_DB_NAME,
    certificateAuthority: env.PIGGYVEST_PRIMARY_CARD_DB_CA,
  };
  const parsed = schemas.runtime.safeParse({
    integrationId: env.PIGGYVEST_PRIMARY_CARD_INTEGRATION_ID,
    merchantId: env.PIGGYVEST_PRIMARY_CARD_MERCHANT_ID,
    businessId: env.PIGGYVEST_PRIMARY_CARD_BUSINESS_ID,
    environment: env.PIGGYVEST_PRIMARY_CARD_ENVIRONMENT,
    expiresAt: env.PIGGYVEST_PRIMARY_CARD_EXPIRES_AT,
    crosswalkAuthority: {
      contractId: env.PIGGYVEST_PRIMARY_CARD_CROSSWALK_CONTRACT_ID,
      evidenceIssuer: env.PIGGYVEST_PRIMARY_CARD_CROSSWALK_ISSUER,
      treasuryWebhookCustomerId:
        env.PIGGYVEST_PRIMARY_CARD_TREASURY_WEBHOOK_CUSTOMER_ID,
      transactionCustomerId: env.PIGGYVEST_PRIMARY_CARD_TRANSACTION_CUSTOMER_ID,
    },
    apiToken: env.PIGGYVEST_PRIMARY_CARD_PIGGYVEST_TOKEN,
    webhookSecret: env.PIGGYVEST_PRIMARY_CARD_PIGGYVEST_WEBHOOK_SECRET,
    transfer: env.PIGGYVEST_PRIMARY_CARD_TRANSFER_PASSWORD
      ? {
          ...database,
          login: 'baci_primary_card_transfer',
          password: env.PIGGYVEST_PRIMARY_CARD_TRANSFER_PASSWORD,
        }
      : undefined,
    custody: {
      ...database,
      login: 'baci_primary_card_custody',
      password: env.PIGGYVEST_PRIMARY_CARD_CUSTODY_PASSWORD,
    },
  });
  if (
    !parsed.success ||
    !Number.isFinite(now) ||
    now >= Date.parse(parsed.data.expiresAt)
  )
    return null;
  return parsed.data;
}
