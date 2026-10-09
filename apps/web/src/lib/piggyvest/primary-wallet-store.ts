import 'server-only';
import { piggyvestPrimaryWalletStoreSchemas as schemas } from '@/schemas/piggyvest-primary-wallet-store';
import type {
  PrimaryWalletIntentScope,
  PrimaryWalletOnboardingStorage,
} from './primary-wallet-onboarding.types';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function createPrimaryWalletStore(input: {
  scope: PrimaryWalletIntentScope;
  execute: PiggyvestProvisioningExecutor;
}): PrimaryWalletOnboardingStorage {
  const scope = schemas.scope.parse(input.scope);
  const scopeJson = JSON.stringify(scope);
  function assertScope(candidate: PrimaryWalletIntentScope) {
    if (
      JSON.stringify(
        schemas.scope.parse({
          merchantId: candidate.merchantId,
          customerId: candidate.customerId,
          userId: candidate.userId,
          integrationId: candidate.integrationId,
          businessId: candidate.businessId,
          environment: candidate.environment,
        })
      ) !== scopeJson
    )
      throw new Error('Scope mismatch');
  }
  return {
    async claim(command) {
      try {
        const parsed = schemas.claim.parse(command);
        assertScope(parsed);
        const response = await input.execute(PRIMARY_WALLET_STATEMENTS.claim, [
          scopeJson,
          parsed.requestFingerprint,
        ]);
        return schemas.claimedRows.parse(response.rows)[0].result;
      } catch {
        throw new Error('Primary wallet storage unavailable');
      }
    },
    async recordAccepted(command) {
      try {
        const parsed = schemas.accepted.parse(command);
        assertScope(parsed);
        const response = await input.execute(PRIMARY_WALLET_STATEMENTS.record, [
          scopeJson,
          parsed.intentId,
          parsed.claimToken,
          parsed.providerCustomerId,
          parsed.providerWalletId,
        ]);
        return schemas.recordedRows.parse(response.rows)[0].result;
      } catch {
        throw new Error('Primary wallet storage unavailable');
      }
    },
    async recordUncertain(command) {
      try {
        const parsed = schemas.uncertain.parse(command);
        assertScope(parsed);
        const response = await input.execute(
          PRIMARY_WALLET_STATEMENTS.uncertain,
          [scopeJson, parsed.intentId, parsed.claimToken]
        );
        if (!schemas.recordedRows.parse(response.rows)[0].result)
          throw new Error('Stale claim');
      } catch {
        throw new Error('Primary wallet storage unavailable');
      }
    },
    async recordRejected(command) {
      try {
        const parsed = schemas.rejected.parse(command);
        assertScope(parsed);
        const response = await input.execute(PRIMARY_WALLET_STATEMENTS.reject, [
          scopeJson,
          parsed.intentId,
          parsed.claimToken,
        ]);
        if (!schemas.recordedRows.parse(response.rows)[0].result)
          throw new Error('Stale claim');
      } catch {
        throw new Error('Primary wallet storage unavailable');
      }
    },
  };
}
