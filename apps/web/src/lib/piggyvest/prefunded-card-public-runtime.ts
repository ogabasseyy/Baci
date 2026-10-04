import 'server-only';
import { prefundedCardPublicRuntimeSchemas } from '@/schemas/prefunded-card-public-runtime';
import { PREFUNDED_CARD_CUSTOMER_STATEMENTS } from './prefunded-card-customer-statements';
import { createPrefundedCardPostgresExecutor } from './prefunded-card-postgres-executor';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function readPrefundedCardPublicRuntime({
  authOrigin,
  environment = process.env,
}: {
  authOrigin: string;
  environment?: NodeJS.ProcessEnv;
}) {
  if (environment.PREFUNDED_CARD_PUBLIC_ENABLED !== 'true') return null;
  try {
    const serialized = environment.PREFUNDED_CARD_PUBLIC_CONFIG;
    if (!serialized || Buffer.byteLength(serialized, 'utf8') > 65_536)
      throw new Error('Unavailable');
    const configuration = prefundedCardPublicRuntimeSchemas.configuration.parse(
      JSON.parse(serialized)
    );
    if (
      authOrigin !== configuration.authOrigin ||
      environment.NEXT_PUBLIC_SUPABASE_URL !== configuration.authOrigin ||
      Date.now() >= Date.parse(configuration.expiresAt)
    )
      throw new Error('Unavailable');
    const { context, database } = configuration;
    const execute = createPrefundedCardPostgresExecutor(database);
    const scopedExecute: PiggyvestProvisioningExecutor = async (
      statement,
      parameters
    ) => {
      if (
        Date.now() >= Date.parse(configuration.expiresAt) ||
        !Object.values(PREFUNDED_CARD_CUSTOMER_STATEMENTS).some(
          (allowed) => allowed === statement
        ) ||
        parameters.length !== 8 ||
        parameters[0] !== context.integrationId ||
        parameters[1] !== context.merchantId ||
        typeof parameters[2] !== 'string' ||
        !context.allowlistedCustomerIds.includes(parameters[2]) ||
        parameters[5] !== context.expectedBusinessId ||
        parameters[6] !== database.expectedSystemId
      )
        throw new Error('Savings card contribution unavailable');
      return await execute(statement, parameters);
    };
    return Object.freeze({
      publicOrigin: configuration.publicOrigin,
      configuration: context,
      card: Object.freeze({
        enabled: true as const,
        expectedSystemId: database.expectedSystemId,
        execute: scopedExecute,
      }),
    });
  } catch {
    throw new Error('Savings card contribution unavailable');
  }
}
