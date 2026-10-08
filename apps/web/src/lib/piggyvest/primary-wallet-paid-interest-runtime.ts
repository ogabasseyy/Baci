import 'server-only';
import { primaryWalletPaidInterestSchemas as schemas } from '@/schemas/primary-wallet-paid-interest';

export function readPrimaryWalletPaidInterestRuntime(
  env: NodeJS.ProcessEnv = process.env
) {
  if (env.PIGGYVEST_PRIMARY_PAID_INTEREST_ENABLED !== 'true') return null;
  if (env.VERCEL_ENV !== 'production')
    throw new Error('Primary paid-interest environment mismatch');
  const parsed = schemas.runtime.safeParse({
    integrationId: env.PIGGYVEST_PRIMARY_INTEGRATION_ID,
    environment: env.PIGGYVEST_PRIMARY_ENVIRONMENT,
    businessId: env.PIGGYVEST_PRIMARY_PAID_INTEREST_BUSINESS_ID,
    providerToken: env.PIGGYVEST_PRIMARY_PAID_INTEREST_API_TOKEN,
    webhookSecret: env.PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET,
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
    throw new Error('Primary paid-interest configuration unavailable');
  return parsed.data;
}
