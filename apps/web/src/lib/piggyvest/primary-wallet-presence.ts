import 'server-only';
import { piggyvestPrimaryWalletSnapshotSchemas } from '@/schemas/piggyvest-primary-wallet-snapshot';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import type { PrimaryWalletIntentScope } from './primary-wallet-onboarding.types';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

/**
 * Whether any durable onboarding intent exists for this exact scope. Read-only
 * and provider-free. Any invalid scope, failed lookup or malformed row throws,
 * so a caller can never mistake "unknown" for "not started".
 */
export async function hasPrimaryWalletOnboarding(
  scope: PrimaryWalletIntentScope,
  execute: PiggyvestProvisioningExecutor
): Promise<boolean> {
  try {
    const parsed = piggyvestPrimaryWalletStoreSchemas.scope.parse(scope);
    const response = await execute(PRIMARY_WALLET_STATEMENTS.presence, [
      JSON.stringify(parsed),
    ]);
    return piggyvestPrimaryWalletSnapshotSchemas.presence.parse(
      response.rows
    )[0].result;
  } catch {
    throw new Error('Primary wallet onboarding presence unavailable');
  }
}
