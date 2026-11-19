import 'server-only';
import { piggyvestPrimaryRolloutCohortRowsSchema } from '@/schemas/piggyvest-primary-wallet-capability';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import type { PrimaryWalletIntentScope } from './primary-wallet-onboarding.types';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

/**
 * Whether this customer is in the onboarding rollout cohort. Runs through
 * the onboarding provisioner's scoped reader, which also proves the
 * integration, merchant, customer and user binding; any failure throws so
 * the capability gate reports unavailable rather than a refusal.
 */
export async function readPrimaryRolloutCohortMembership(input: {
  scope: PrimaryWalletIntentScope;
  execute: PiggyvestProvisioningExecutor;
}): Promise<boolean> {
  try {
    const scope = piggyvestPrimaryWalletStoreSchemas.scope.parse(input.scope);
    const response = await input.execute(
      PRIMARY_WALLET_STATEMENTS.readRolloutCohort,
      [JSON.stringify(scope)]
    );
    return piggyvestPrimaryRolloutCohortRowsSchema.parse(response.rows)[0]
      .result;
  } catch {
    throw new Error('Primary rollout cohort unavailable');
  }
}
