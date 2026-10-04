import 'server-only';
import { piggyvestWalletMappingSchemas } from '@/schemas/piggyvest-wallet-mapping';
import { PIGGYVEST_POSTGRES_STATEMENTS } from './postgres-statements';

export async function resolvePiggyvestWalletMapping({
  configuration,
  input,
  execute,
}: {
  configuration: unknown;
  input: unknown;
  execute: (
    statement: string,
    parameters: readonly unknown[]
  ) => Promise<{ rows: unknown[] }>;
}): Promise<{ merchantId: string; customerId: string; goalId: string } | null> {
  const config =
    piggyvestWalletMappingSchemas.configuration.safeParse(configuration);
  const identity = piggyvestWalletMappingSchemas.input.safeParse(input);
  if (!config.success || !identity.success) return null;
  try {
    const response = await execute(
      PIGGYVEST_POSTGRES_STATEMENTS.resolveWalletMapping.text,
      [
        config.data.integrationId,
        identity.data.providerWalletId,
        identity.data.providerCustomerId,
      ]
    );
    const rows = piggyvestWalletMappingSchemas.response.safeParse(
      response.rows
    );
    if (!rows.success || rows.data.length !== 1) return null;
    const mapping = rows.data[0];
    if (mapping.merchant_id !== config.data.expectedMerchantId) return null;
    return {
      merchantId: mapping.merchant_id,
      customerId: mapping.customer_id,
      goalId: mapping.goal_id,
    };
  } catch {
    return null;
  }
}
