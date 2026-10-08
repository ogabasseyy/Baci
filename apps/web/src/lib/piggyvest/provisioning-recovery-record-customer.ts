import 'server-only';
import { piggyvestProvisioningRecoverySchemas as schemas } from '@/schemas/piggyvest-provisioning-recovery';
import { PIGGYVEST_PROVISIONING_RECOVERY_STATEMENTS as statements } from './provisioning-recovery-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export async function recordPiggyvestCreatedCustomer({
  configuration,
  acknowledgement,
  execute,
}: {
  configuration: unknown;
  acknowledgement: unknown;
  execute: PiggyvestProvisioningExecutor;
}): Promise<'awaiting_confirmation' | 'unknown' | 'stale'> {
  try {
    const config = schemas.configuration.parse(configuration);
    const result = schemas.customerAcknowledgement.parse(acknowledgement);
    const response = await execute(statements.recordCreatedCustomer.text, [
      config.integrationId,
      config.expectedMerchantId,
      result.intentId,
      result.claimToken,
      config.expectedBusinessId,
      result.providerCustomerId,
      result.providerWalletId,
    ]);
    return schemas.customerRecorded.parse(response.rows)[0].outcome;
  } catch {
    throw new Error('PiggyVest recovery storage unavailable');
  }
}
