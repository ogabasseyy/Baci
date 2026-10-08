import 'server-only';
import { primaryWalletBankInboxSchemas as schemas } from '@/schemas/primary-wallet-bank-inbox';

export function readPrimaryWalletBankInboxRuntime(
  mode: 'intake' | 'worker',
  env: NodeJS.ProcessEnv = process.env,
  now = new Date()
) {
  if (
    env.PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED === undefined ||
    env.PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED === 'false'
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
  if (env.PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED !== 'true' || !parsed.success)
    throw new Error('Primary bank inbox configuration unavailable');
  if (
    (env.VERCEL_ENV === 'production') !==
      (parsed.data.environment === 'production') ||
    new Date(parsed.data.scope.expiresAt) <= now
  )
    throw new Error('Primary bank inbox scope unavailable');
  return parsed.data;
}
