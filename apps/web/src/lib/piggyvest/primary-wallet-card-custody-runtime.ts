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
  // Malformed rotation config fails the whole runtime closed: the worker
  // must re-verify every secret the intake accepted, so a partial retained
  // list would strand or mis-verify retained-signed claims.
  let retained: unknown = [];
  try {
    if (env.PIGGYVEST_PRIMARY_CARD_RETAINED_PIGGYVEST_WEBHOOK_SECRETS)
      retained = JSON.parse(
        env.PIGGYVEST_PRIMARY_CARD_RETAINED_PIGGYVEST_WEBHOOK_SECRETS
      );
  } catch {
    return null;
  }
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
    retainedWebhookSecrets: retained,
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
  // No integration-deadline check (see the intake runtime reader): the worker
  // drains already-acknowledged inbox receipts, so a post-expiry run settles
  // in-flight custody instead of stranding charged checkouts in
  // custody_pending with no path to credit. expiresAt stays in the scope so
  // the database still pins callers to the exact authority row, and flags,
  // environment binding, credentials, and finite DB role validity still
  // fail closed.
  if (!parsed.success || !Number.isFinite(now)) return null;
  return parsed.data;
}
