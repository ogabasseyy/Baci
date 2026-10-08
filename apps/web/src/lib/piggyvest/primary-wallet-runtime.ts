import 'server-only';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';

export function readPrimaryWalletRuntime(env: NodeJS.ProcessEnv = process.env) {
  if (env.PIGGYVEST_PRIMARY_ENABLED !== 'true') return null;
  const environment = env.PIGGYVEST_PRIMARY_ENVIRONMENT;
  if (
    (env.VERCEL_ENV === 'production' && environment !== 'production') ||
    (env.VERCEL_ENV !== 'production' && environment === 'production')
  )
    return null;
  const parsed = piggyvestPrimaryWalletRuntimeSchema.safeParse({
    onboarding: {
      environment,
      merchantId: env.PIGGYVEST_PRIMARY_MERCHANT_ID,
      integrationId: env.PIGGYVEST_PRIMARY_INTEGRATION_ID,
      businessId: env.PIGGYVEST_PRIMARY_BUSINESS_ID,
      businessBindingVerified:
        env.PIGGYVEST_PRIMARY_BUSINESS_BINDING_VERIFIED === 'true',
      fingerprintKey: env.PIGGYVEST_PRIMARY_FINGERPRINT_KEY,
    },
    providerToken: env.PIGGYVEST_PRIMARY_PROVIDER_TOKEN,
    database: {
      host: env.PIGGYVEST_PRIMARY_DB_HOST,
      port: Number(env.PIGGYVEST_PRIMARY_DB_PORT),
      name: env.PIGGYVEST_PRIMARY_DB_NAME,
      login: 'baci_piggyvest_primary_provisioner',
      password: env.PIGGYVEST_PRIMARY_DB_PASSWORD,
      certificateAuthority: env.PIGGYVEST_PRIMARY_DB_CA,
    },
  });
  return parsed.success ? parsed.data : null;
}
