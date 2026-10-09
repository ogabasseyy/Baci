import 'server-only';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsRuntimeSchema } from '@/schemas/piggyvest-primary-savings-runtime';
import {
  readPrimaryWalletRuntime,
  readPrimaryWalletRuntimeDrain,
} from './primary-wallet-runtime';

function readPrimaryWalletSavingsCore(env: NodeJS.ProcessEnv, drain: boolean) {
  const primary = drain
    ? readPrimaryWalletRuntimeDrain(env)
    : readPrimaryWalletRuntime(env);
  if (!primary) throw new Error('Primary savings configuration unavailable');
  const configuration = piggyvestPrimarySavingsRuntimeSchema.parse({
    integrationId: primary.onboarding.integrationId,
    environment: primary.onboarding.environment,
    database: {
      ...primary.database,
      login: 'baci_piggyvest_primary_authorizer',
      password: env.PIGGYVEST_PRIMARY_AUTHORIZER_DB_PASSWORD,
    },
  });
  return { primary, configuration };
}

export function readPrimaryWalletSavingsRuntime(
  env: NodeJS.ProcessEnv = process.env
) {
  if (env.PIGGYVEST_PRIMARY_SAVINGS_ENABLED !== 'true') return null;
  const { primary, configuration } = readPrimaryWalletSavingsCore(env, false);
  return {
    configuration,
    reconciliationConfiguration: piggyvestPrimaryInflowRuntimeSchema.parse({
      integrationId: primary.onboarding.integrationId,
      environment: primary.onboarding.environment,
      database: {
        ...primary.database,
        login: 'baci_piggyvest_primary_evidence',
        password: env.PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD,
      },
    }),
    merchantId: primary.onboarding.merchantId,
    businessId: primary.onboarding.businessId,
    providerToken: primary.providerToken,
  };
}

/**
 * Recovery-only savings configuration: durable pending lookups, status
 * reconciliation, and outflow attribution must run even when the savings
 * runtime or the base primary flag is disabled, so a rollback can never
 * mistake "runtime off" for "no outstanding operation" and strand a
 * provider-accepted transfer as pending permanently. The reconciliation
 * handles here only settle or release already-dispatched operations —
 * reserving or dispatching new ones stays behind the enabled flags.
 */
export function readPrimaryWalletSavingsRecoveryRuntime(
  env: NodeJS.ProcessEnv = process.env
) {
  const { primary, configuration } = readPrimaryWalletSavingsCore(env, true);
  return {
    configuration,
    reconciliationConfiguration: piggyvestPrimaryInflowRuntimeSchema.parse({
      integrationId: primary.onboarding.integrationId,
      environment: primary.onboarding.environment,
      database: {
        ...primary.database,
        login: 'baci_piggyvest_primary_evidence',
        password: env.PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD,
      },
    }),
    merchantId: primary.onboarding.merchantId,
    businessId: primary.onboarding.businessId,
    providerToken: primary.providerToken,
  };
}
