import 'server-only';
import { primaryWalletPaidInterestInboxSchemas as schemas } from '@/schemas/primary-wallet-paid-interest-inbox';

export type PrimaryWalletPaidInterestInboxSecrets = {
  webhookSecret: unknown;
  retainedWebhookSecrets: unknown;
};

/**
 * Authentication keys independent of worker readiness (see the bank
 * secrets reader): the outer gate verifies with these while the intake
 * itself still fails closed on incomplete provisioning. The enabled flag
 * gates processing only, never verification: during a processing
 * rollback the keys stay available so legitimate deliveries retry
 * instead of being silently dropped as invalid.
 *
 * Malformed retained-key JSON throws instead of degrading to the
 * current key alone: verifying with a partial key set would classify a
 * retained-signed delivery as invalid (200-acked, provider stops
 * retrying) before the intake's own 503 could save it. The union maps
 * the throw to unconfigured so unmatched deliveries retry.
 */
export function readPrimaryWalletPaidInterestInboxSecrets(
  env: NodeJS.ProcessEnv = process.env
): PrimaryWalletPaidInterestInboxSecrets | null {
  if (env.VERCEL_ENV !== 'production') return null;
  let retainedWebhookSecrets: unknown = [];
  try {
    retainedWebhookSecrets = JSON.parse(
      env.PIGGYVEST_PRIMARY_PAID_INTEREST_RETAINED_WEBHOOK_SECRETS ?? '[]'
    );
  } catch {
    throw new Error('Primary paid interest secrets unavailable');
  }
  const webhookSecret = env.PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET;
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

export function readPrimaryWalletPaidInterestInboxRuntime(
  mode: 'intake' | 'worker',
  env: NodeJS.ProcessEnv = process.env
) {
  // Intake stops at the flag (no new rows while disabled); the worker
  // drains already-acknowledged rows through the same credentials-bound
  // config, or a rollback leaves queued payouts permanently unapplied.
  if (
    mode === 'intake' &&
    env.PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED !== 'true'
  )
    return null;
  if (env.VERCEL_ENV !== 'production')
    throw new Error('Primary interest inbox environment mismatch');
  let retainedWebhookSecrets: unknown = [];
  try {
    retainedWebhookSecrets = JSON.parse(
      env.PIGGYVEST_PRIMARY_PAID_INTEREST_RETAINED_WEBHOOK_SECRETS ?? '[]'
    );
  } catch {
    throw new Error('Primary interest inbox configuration unavailable');
  }
  const parsed = schemas.runtime.safeParse({
    integrationId: env.PIGGYVEST_PRIMARY_INTEGRATION_ID,
    environment: env.PIGGYVEST_PRIMARY_ENVIRONMENT,
    businessId: env.PIGGYVEST_PRIMARY_PAID_INTEREST_BUSINESS_ID,
    webhookSecret: env.PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET,
    retainedWebhookSecrets,
    database: {
      host: env.PIGGYVEST_PRIMARY_DB_HOST,
      port: Number(env.PIGGYVEST_PRIMARY_DB_PORT),
      name: env.PIGGYVEST_PRIMARY_DB_NAME,
      login: 'baci_piggyvest_primary_evidence',
      password: env.PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD,
      certificateAuthority: env.PIGGYVEST_PRIMARY_DB_CA,
    },
  });
  if (!parsed.success)
    throw new Error('Primary interest inbox configuration unavailable');
  return parsed.data;
}
