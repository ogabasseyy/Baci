import 'server-only';
import { primaryCardCustodyInboxSchemas as schemas } from '@/schemas/primary-wallet-card-custody-inbox';

export type PrimaryCardCustodyIntakeSecrets = {
  webhookSecret: unknown;
  retainedWebhookSecrets: unknown;
};

/**
 * Authentication keys independent of intake readiness (see the bank
 * secrets reader): the outer gate verifies with these while the intake
 * itself still fails closed on incomplete provisioning. The enabled
 * flags gate processing only, never verification: during a processing
 * rollback the keys stay available so legitimate deliveries retry
 * instead of being silently dropped as invalid.
 *
 * Malformed retained-key JSON throws instead of degrading to the
 * current key alone: verifying with a partial key set would classify a
 * retained-signed delivery as invalid (200-acked, provider stops
 * retrying) before the intake's own 503 could save it. The union maps
 * the throw to unconfigured so unmatched deliveries retry.
 */
export function readPrimaryCardCustodyIntakeSecrets(
  env: NodeJS.ProcessEnv = process.env
): PrimaryCardCustodyIntakeSecrets | null {
  if (
    (env.VERCEL_ENV === 'production') !==
    (env.PIGGYVEST_PRIMARY_CARD_ENVIRONMENT === 'production')
  )
    return null;
  let retainedWebhookSecrets: unknown = [];
  try {
    if (env.PIGGYVEST_PRIMARY_CARD_RETAINED_PIGGYVEST_WEBHOOK_SECRETS)
      retainedWebhookSecrets = JSON.parse(
        env.PIGGYVEST_PRIMARY_CARD_RETAINED_PIGGYVEST_WEBHOOK_SECRETS
      );
  } catch {
    throw new Error('Primary card custody secrets unavailable');
  }
  const webhookSecret = env.PIGGYVEST_PRIMARY_CARD_PIGGYVEST_WEBHOOK_SECRET;
  if (
    (typeof webhookSecret !== 'string' || !webhookSecret.trim()) &&
    (!Array.isArray(retainedWebhookSecrets) ||
      retainedWebhookSecrets.length === 0)
  )
    return null;
  return {
    webhookSecret,
    retainedWebhookSecrets,
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
  // Retained keys parse in both intake and worker modes: the outer webhook
  // gate and this intake read the intake runtime, so a rotation key must
  // verify there — worker-only parsing would strand retained-signed
  // retries as invalid.
  let retained: unknown = [];
  try {
    if (env.PIGGYVEST_PRIMARY_CARD_RETAINED_PIGGYVEST_WEBHOOK_SECRETS)
      retained = JSON.parse(
        env.PIGGYVEST_PRIMARY_CARD_RETAINED_PIGGYVEST_WEBHOOK_SECRETS
      );
  } catch {
    return null;
  }
  const parsed = schemas.intakeRuntime.safeParse({
    intakeOnly: true,
    integrationId: env.PIGGYVEST_PRIMARY_CARD_INTEGRATION_ID,
    merchantId: env.PIGGYVEST_PRIMARY_CARD_MERCHANT_ID,
    businessId: env.PIGGYVEST_PRIMARY_CARD_BUSINESS_ID,
    environment: env.PIGGYVEST_PRIMARY_CARD_ENVIRONMENT,
    expiresAt: env.PIGGYVEST_PRIMARY_CARD_EXPIRES_AT,
    webhookSecret: env.PIGGYVEST_PRIMARY_CARD_PIGGYVEST_WEBHOOK_SECRET,
    retainedWebhookSecrets: retained,
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
  // No integration-deadline check: intake receipts complete transfers
  // dispatched before expiry, so a post-expiry run drains in-flight
  // custody instead of stranding it. Flags, environment binding,
  // credentials, and (in the database) the intake credential expiry
  // still fail closed.
  if (!parsed.success || !Number.isFinite(now)) return null;
  return parsed.data;
}
