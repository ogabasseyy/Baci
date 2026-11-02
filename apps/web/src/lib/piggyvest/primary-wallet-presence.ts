import 'server-only';
import { piggyvestPrimaryWalletSnapshotSchemas } from '@/schemas/piggyvest-primary-wallet-snapshot';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export async function hasPrimaryWalletOnboarding(
  scope: unknown,
  execute: PiggyvestProvisioningExecutor
) {
  const parsed = piggyvestPrimaryWalletStoreSchemas.scope.parse(scope);
  const response = await execute(PRIMARY_WALLET_STATEMENTS.presence, [
    JSON.stringify(parsed),
  ]);
  return piggyvestPrimaryWalletSnapshotSchemas.presence.parse(response.rows)[0]
    .result;
}
