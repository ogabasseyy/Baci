import 'server-only';
import type { z } from 'zod';
import { primaryWalletVerificationSchemas as schemas } from '@/schemas/primary-wallet-verification';
import type { PrimaryWalletIntentScope } from './primary-wallet-onboarding.types';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export type PrimaryWalletVerificationProof = z.infer<typeof schemas.proof>;

export const PRIMARY_WALLET_VERIFICATION_STATEMENT =
  'SELECT piggyvest_primary.verify_onboarding($1::jsonb, $2::jsonb) AS result';

export async function verifyPrimaryWalletMapping(input: {
  scope: PrimaryWalletIntentScope;
  proof: unknown;
  execute: PiggyvestProvisioningExecutor;
}): Promise<boolean> {
  try {
    const scope = schemas.scope.parse(input.scope);
    const proof = schemas.proof.parse(input.proof);
    if (
      proof.wallet.id !== proof.mapping.providerWalletId ||
      proof.wallet.api_customer_id !== proof.mapping.providerCustomerId ||
      proof.wallet.business_id !== scope.businessId ||
      proof.wallet.status !== 'active'
    ) {
      return false;
    }
    const response = await input.execute(
      PRIMARY_WALLET_VERIFICATION_STATEMENT,
      [
        JSON.stringify(scope),
        JSON.stringify({
          providerCustomerId: proof.mapping.providerCustomerId,
          providerWalletId: proof.mapping.providerWalletId,
          businessId: proof.wallet.business_id,
          currency: proof.wallet.currency,
          status: proof.wallet.status,
          hasFundingAccount: true,
        }),
      ]
    );
    return schemas.result.parse(response.rows)[0].result;
  } catch {
    throw new Error('Primary wallet verification unavailable');
  }
}
