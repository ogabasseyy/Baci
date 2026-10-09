import 'server-only';
import { primaryCardCustodyInboxSchemas as schemas } from '@/schemas/primary-wallet-card-custody-inbox';

export type PrimaryCardCustodyIntakeSecrets = {
  webhookSecret: unknown;
};

/**
 * Authentication keys independent of intake readiness (see the bank
 * secrets reader): the outer gate verifies with these while the intake
 * itself still fails closed on incomplete provisioning. The enabled
 * flags gate processing only, never verification: during a processing
 * rollback the keys stay available so legitimate deliveries retry
 * instead of being silently dropped as invalid.
 */
export function readPrimaryCardCustodyIntakeSecrets(
  env: NodeJS.ProcessEnv = process.env
): PrimaryCardCustodyIntakeSecrets | null {
  if (
    (env.VERCEL_ENV === 'production') !==
    (env.PIGGYVEST_PRIMARY_CARD_ENVIRONMENT === 'production')
  )
    return null;
  const webhookSecret = env.PIGGYVEST_PRIMARY_CARD_PIGGYVEST_WEBHOOK_SECRET;
  if (typeof webhookSecret !== 'string' || !webhookSecret.trim()) return null;
  return {
    webhookSecret,
  };
}

export function readPrimaryCardCustodyIntakeRuntime(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now()
) {
  if (
    env.PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED !== 'true' ||
    env.PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED !== 'true' ||
    (env.VERCEL_ENV === 'production') !==
      (env.PIGGYVEST_PRIMARY_CARD_ENVIRONMENT === 'production')
  )
    return null;
  const parsed = schemas.intakeRuntime.safeParse({
    intakeOnly: true,
    integrationId: env.PIGGYVEST_PRIMARY_CARD_INTEGRATION_ID,
    merchantId: env.PIGGYVEST_PRIMARY_CARD_MERCHANT_ID,
    businessId: env.PIGGYVEST_PRIMARY_CARD_BUSINESS_ID,
    environment: env.PIGGYVEST_PRIMARY_CARD_ENVIRONMENT,
    expiresAt: env.PIGGYVEST_PRIMARY_CARD_EXPIRES_AT,
    webhookSecret: env.PIGGYVEST_PRIMARY_CARD_PIGGYVEST_WEBHOOK_SECRET,
    crosswalkAuthority: {
      contractId: env.PIGGYVEST_PRIMARY_CARD_CROSSWALK_CONTRACT_ID,
      evidenceIssuer: env.PIGGYVEST_PRIMARY_CARD_CROSSWALK_ISSUER,
      treasuryWebhookCustomerId:
        env.PIGGYVEST_PRIMARY_CARD_TREASURY_WEBHOOK_CUSTOMER_ID,
      transactionCustomerId: env.PIGGYVEST_PRIMARY_CARD_TRANSACTION_CUSTOMER_ID,
    },
    custody: {
      login: 'baci_primary_card_intake',
      host: env.PIGGYVEST_PRIMARY_CARD_DB_HOST,
      port: Number(env.PIGGYVEST_PRIMARY_CARD_DB_PORT),
      name: env.PIGGYVEST_PRIMARY_CARD_DB_NAME,
      certificateAuthority: env.PIGGYVEST_PRIMARY_CARD_DB_CA,
      password: env.PIGGYVEST_PRIMARY_CARD_INTAKE_PASSWORD,
    },
    signedInbox: {
      payloadContract: env.PIGGYVEST_PRIMARY_CARD_SIGNED_PAYLOAD_CONTRACT,
      mappingContract: env.PIGGYVEST_PRIMARY_CARD_SIGNED_MAPPING_CONTRACT,
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
