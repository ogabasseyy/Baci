import 'server-only';
import { primaryWalletBankInboxSchemas as schemas } from '@/schemas/primary-wallet-bank-inbox';

export type PrimaryWalletBankInboxSecrets = {
  webhookSecret: unknown;
  retainedWebhookSecrets: unknown;
};

/**
 * Authentication keys independent of worker readiness: the outer webhook
 * gate collects these so a bank-signed delivery still verifies (and then
 * receives a retryable 503 from the unready intake) instead of being
 * 200-ACKed as invalid when e.g. the database password is missing. The
 * enabled flag gates processing only, never verification: during a
 * processing rollback the keys stay available so legitimate deliveries
 * retry instead of being silently dropped as invalid.
 */
export function readPrimaryWalletBankInboxSecrets(
  env: NodeJS.ProcessEnv = process.env
): PrimaryWalletBankInboxSecrets | null {
  let retainedWebhookSecrets: unknown = [];
  try {
    if (env.PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS)
      retainedWebhookSecrets = JSON.parse(
        env.PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS
      );
  } catch {
    // Malformed rotation config drops the retained list only; the full
    // runtime still fails closed and the intake answers 503.
    retainedWebhookSecrets = [];
  }
  const webhookSecret = env.PIGGYVEST_PRIMARY_BANK_INBOX_WEBHOOK_SECRET;
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

export function readPrimaryWalletBankInboxRuntime(
  mode: 'intake' | 'worker',
  env: NodeJS.ProcessEnv = process.env
) {
  // Intake stops at the flag (no new rows while disabled); the worker
  // drains already-acknowledged rows through the same credentials-bound
  // config, or a rollback strands provider-acked deposits with no retry
  // path and no local credit.
  if (
    mode === 'intake' &&
    (env.PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED === undefined ||
      env.PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED === 'false')
  )
    return null;
  // Retained keys parse in both modes: the outer webhook gate and this
  // intake read the intake runtime, so a rotation key must verify there —
  // worker-only parsing would strand retained-signed retries as invalid.
  let retained: unknown = [];
  try {
    if (env.PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS)
      retained = JSON.parse(
        env.PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS
      );
  } catch {
    throw new Error('Primary bank inbox configuration unavailable');
  }
  const parsed = schemas.runtime.safeParse({
    integrationId: env.PIGGYVEST_PRIMARY_INTEGRATION_ID,
    environment: env.PIGGYVEST_PRIMARY_ENVIRONMENT,
    scope: {
      merchantId: env.PIGGYVEST_PRIMARY_MERCHANT_ID,
      businessId: env.PIGGYVEST_PRIMARY_BUSINESS_ID,
      expiresAt: env.PIGGYVEST_PRIMARY_BANK_INBOX_EXPIRES_AT,
    },
    webhookSecret: env.PIGGYVEST_PRIMARY_BANK_INBOX_WEBHOOK_SECRET,
    retainedWebhookSecrets: retained,
    database: {
      host: env.PIGGYVEST_PRIMARY_DB_HOST,
      port: Number(env.PIGGYVEST_PRIMARY_DB_PORT),
      name: env.PIGGYVEST_PRIMARY_DB_NAME,
      login:
        mode === 'intake'
          ? 'baci_primary_bank_intake'
          : 'baci_primary_bank_worker',
      password:
        mode === 'intake'
          ? env.PIGGYVEST_PRIMARY_BANK_INTAKE_PASSWORD
          : env.PIGGYVEST_PRIMARY_BANK_WORKER_PASSWORD,
      certificateAuthority: env.PIGGYVEST_PRIMARY_DB_CA,
    },
  });
  // An enabled inbox additionally requires the drain schedule
  // attestation: queueing deposits while no timer drains the inbox
  // would leave them uncredited after the provider stops retrying.
  // Without it intake fails closed (retryable 503) instead of
  // acknowledging rows nobody will drain. The operator sets the flag
  // only after installing and enabling the drain timer.
  if (
    (mode === 'intake' &&
      (env.PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED !== 'true' ||
        env.PIGGYVEST_PRIMARY_BANK_INBOX_DRAIN_SCHEDULED !== 'true')) ||
    !parsed.success
  )
    throw new Error('Primary bank inbox configuration unavailable');
  // No deposit-deadline check: intake enqueues only owned (existing
  // verified) mappings and the worker processes only enqueued rows, so
  // both modes are drain-only by construction. Refusing them past
  // expiry would 503 signed deposits into existing wallets until
  // retries exhaust, stranding money with no local credit; the
  // deadline gates new exposure, never deposit processing. expiresAt
  // stays in the scope so the database still pins callers to the exact
  // authority row (no deadline substitution).
  if (
    (env.VERCEL_ENV === 'production') !==
    (parsed.data.environment === 'production')
  )
    throw new Error('Primary bank inbox scope unavailable');
  return parsed.data;
}
