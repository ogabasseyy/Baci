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

/**
 * Persists the staging wallet-to-goal binding provisioned for a savings
 * goal. Without this row, funding-accounts retrieval 202-loops on
 * MAPPING_PENDING and inflow/interest webhooks for the dedicated wallet
 * 503-loop on UNMAPPED. Returns false (never throws) when the call cannot
 * be proven durable so the caller fails closed to pending; the record
 * function itself is idempotent for identical re-records.
 */
export async function recordPiggyvestWalletMapping({
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
}): Promise<boolean> {
  const config =
    piggyvestWalletMappingSchemas.configuration.safeParse(configuration);
  const identity = piggyvestWalletMappingSchemas.recordInput.safeParse(input);
  if (!config.success || !identity.success) return false;
  if (identity.data.merchantId !== config.data.expectedMerchantId) return false;
  try {
    const response = await execute(
      PIGGYVEST_POSTGRES_STATEMENTS.recordWalletGoalMapping.text,
      [
        config.data.integrationId,
        identity.data.providerWalletId,
        identity.data.providerCustomerId,
        identity.data.merchantId,
        identity.data.customerId,
        identity.data.goalId,
      ]
    );
    const rows = piggyvestWalletMappingSchemas.recordResponse.safeParse(
      response.rows
    );
    return rows.success && rows.data[0].recorded === true;
  } catch {
    return false;
  }
}
