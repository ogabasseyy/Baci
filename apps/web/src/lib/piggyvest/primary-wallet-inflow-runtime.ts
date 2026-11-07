import 'server-only';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { isPiggyvestFeatureOn } from './piggyvest-feature-on';

export function readPrimaryWalletInflowRuntime(
  env: NodeJS.ProcessEnv = process.env
) {
  if (!isPiggyvestFeatureOn('inflows', env)) return null;
  const parsed = piggyvestPrimaryInflowRuntimeSchema.safeParse({
    integrationId: env.PIGGYVEST_PRIMARY_INTEGRATION_ID,
    environment: env.PIGGYVEST_PRIMARY_ENVIRONMENT,
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
    throw new Error('Primary wallet inflow configuration unavailable');
  if (
    (env.VERCEL_ENV === 'production') !==
    (parsed.data.environment === 'production')
  )
    throw new Error('Primary wallet inflow environment mismatch');
  return parsed.data;
}
