import 'server-only';
import { piggyvestPrimaryWalletSnapshotSchemas } from '@/schemas/piggyvest-primary-wallet-snapshot';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import type { PrimaryWalletIntentScope } from './primary-wallet-onboarding.types';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export async function readPrimaryWalletMapping(
  scope: PrimaryWalletIntentScope,
  execute: PiggyvestProvisioningExecutor
) {
  try {
    const selected = piggyvestPrimaryWalletStoreSchemas.scope.parse(scope);
    const response = await execute(PRIMARY_WALLET_STATEMENTS.read, [
      JSON.stringify(selected),
    ]);
    const row = response.rows[0];
    if (
      response.rows.length !== 1 ||
      !row ||
      typeof row !== 'object' ||
      !('result' in row)
    ) {
      throw new Error('Missing mapping response');
    }
    return piggyvestPrimaryWalletSnapshotSchemas.mapping.parse(row.result);
  } catch {
    throw new Error('Primary wallet mapping unavailable');
  }
}
