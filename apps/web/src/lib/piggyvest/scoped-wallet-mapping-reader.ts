import 'server-only';
import { piggyvestScopedWalletMappingSchemas as schemas } from '@/schemas/piggyvest-scoped-wallet-mapping';
import { PIGGYVEST_POSTGRES_STATEMENTS } from './postgres-statements';

export async function readScopedPiggyvestWalletMapping({
  configuration,
  scope,
  execute,
}: {
  configuration: unknown;
  scope: unknown;
  execute: (
    statement: string,
    parameters: readonly unknown[]
  ) => Promise<{ rows: unknown[] }>;
}): Promise<{
  providerCustomerId: string;
  providerWalletId: string;
} | null> {
  const parsedConfiguration = schemas.configuration.safeParse(configuration);
  const parsedScope = schemas.scope.safeParse(scope);
  if (
    !parsedConfiguration.success ||
    !parsedScope.success ||
    parsedConfiguration.data.expectedMerchantId !== parsedScope.data.merchantId
  ) {
    return null;
  }
  const response = await execute(
    PIGGYVEST_POSTGRES_STATEMENTS.readScopedWalletMapping.text,
    [
      parsedConfiguration.data.integrationId,
      parsedScope.data.merchantId,
      parsedScope.data.customerId,
      parsedScope.data.goalId,
    ]
  );
  const rows = schemas.response.safeParse(response.rows);
  if (!rows.success) throw new Error('PiggyVest wallet mapping unavailable');
  if (rows.data.length !== 1) return null;
  return {
    providerCustomerId: rows.data[0].provider_customer_id,
    providerWalletId: rows.data[0].provider_wallet_id,
  };
}
