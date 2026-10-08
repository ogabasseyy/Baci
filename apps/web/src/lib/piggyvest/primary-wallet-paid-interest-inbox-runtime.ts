import 'server-only';
import { primaryWalletPaidInterestInboxSchemas as schemas } from '@/schemas/primary-wallet-paid-interest-inbox';

export function readPrimaryWalletPaidInterestInboxRuntime(
  env: NodeJS.ProcessEnv = process.env
) {
  if (env.PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED !== 'true') return null;
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
