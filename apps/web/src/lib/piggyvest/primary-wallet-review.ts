import 'server-only';
import { piggyvestPrimaryWalletReviewSchemas as schemas } from '@/schemas/piggyvest-primary-wallet-review';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import type { PrimaryWalletIntentScope } from './primary-wallet-onboarding.types';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

/** Reads only a scoped terminal review reason; provider identifiers stay in storage. */
export async function readPrimaryWalletReview(input: {
  scope: PrimaryWalletIntentScope;
  execute: PiggyvestProvisioningExecutor;
}): Promise<'routing' | 'ownership' | null> {
  try {
    const scope = piggyvestPrimaryWalletStoreSchemas.scope.parse(input.scope);
    const response = await input.execute(PRIMARY_WALLET_STATEMENTS.readReview, [
      JSON.stringify(scope),
    ]);
    return schemas.rows.parse(response.rows)[0].result;
  } catch {
    throw new Error('Primary wallet review unavailable');
  }
}
