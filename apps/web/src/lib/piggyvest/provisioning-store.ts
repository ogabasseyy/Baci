import 'server-only';
import { piggyvestProvisioningStoreSchemas as schemas } from '@/schemas/piggyvest-provisioning-store';
import { PIGGYVEST_POSTGRES_STATEMENTS } from './postgres-statements';
import { PIGGYVEST_PROVISIONING_LIMITS } from './provisioning-limits';
import type {
  PiggyvestProvisioningExecutor,
  PiggyvestProvisioningIdentity,
  PiggyvestProvisioningStore,
} from './provisioning-store.types';

export function createPiggyvestProvisioningStore({
  configuration,
  execute,
}: {
  configuration: unknown;
  execute: PiggyvestProvisioningExecutor;
}): PiggyvestProvisioningStore {
  const parsed = schemas.configuration.safeParse(configuration);
  if (!parsed.success || typeof execute !== 'function') {
    throw new Error('PiggyVest provisioning storage unavailable');
  }
  const config = parsed.data;
  function validateIdentity(input: PiggyvestProvisioningIdentity) {
    const identity = schemas.identity.safeParse(input);
    if (
      !identity.success ||
      identity.data.merchantId !== config.expectedMerchantId
    ) {
      throw new Error('PiggyVest provisioning storage unavailable');
    }
    return identity.data;
  }
  return {
    async prepare(input) {
      try {
        const identity = validateIdentity(input);
        const response = await execute(
          PIGGYVEST_POSTGRES_STATEMENTS.prepareProvisioning.text,
          [
            config.integrationId,
            config.expectedMerchantId,
            identity.customerId,
            identity.goalId,
            identity.kind,
            Buffer.from(identity.requestFingerprint, 'hex'),
          ]
        );
        const rows = schemas.prepared.parse(response.rows);
        const row = rows[0];
        return {
          intentId: row.intent_id,
          outcome: row.outcome,
          status: row.status,
        };
      } catch {
        throw new Error('PiggyVest provisioning storage unavailable');
      }
    },
    async claim(intentId, input) {
      try {
        schemas.intentId.parse(intentId);
        const identity = validateIdentity(input);
        const response = await execute(
          PIGGYVEST_POSTGRES_STATEMENTS.claimProvisioning.text,
          [
            config.integrationId,
            config.expectedMerchantId,
            intentId,
            PIGGYVEST_PROVISIONING_LIMITS.claimLeaseSeconds,
            config.expectedBusinessId,
            identity.providerCustomerId,
          ]
        );
        const rows = schemas.claimed.parse(response.rows);
        if (rows.length === 0) return null;
        const claim = rows[0];
        if (
          claim.intent_id !== intentId ||
          claim.operation !== identity.kind ||
          claim.merchant_id !== identity.merchantId ||
          claim.customer_id !== identity.customerId ||
          claim.goal_id !== identity.goalId ||
          claim.request_fingerprint !== identity.requestFingerprint ||
          claim.lease_expires_at_ms <=
            Date.now() + PIGGYVEST_PROVISIONING_LIMITS.minimumRemainingLeaseMs
        ) {
          throw new Error('PiggyVest provisioning storage unavailable');
        }
        return claim.claim_token;
      } catch {
        throw new Error('PiggyVest provisioning storage unavailable');
      }
    },
    async record(input) {
      try {
        const result = schemas.record.parse(input);
        const response = await execute(
          result.newCustomer
            ? PIGGYVEST_POSTGRES_STATEMENTS.recordCreatedCustomer.text
            : PIGGYVEST_POSTGRES_STATEMENTS.recordProvisioning.text,
          [
            config.integrationId,
            config.expectedMerchantId,
            result.intentId,
            result.claimToken,
            result.newCustomer ? config.expectedBusinessId : result.resultCode,
            result.providerCustomerId,
            result.providerWalletId,
          ]
        );
        return schemas.recorded.parse(response.rows)[0].outcome;
      } catch {
        throw new Error('PiggyVest provisioning storage unavailable');
      }
    },
  };
}
