import 'server-only';
import { piggyvestProvisioningRecoverySchemas as schemas } from '@/schemas/piggyvest-provisioning-recovery';
import { PIGGYVEST_PROVISIONING_RECOVERY_STATEMENTS as statements } from './provisioning-recovery-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function createPiggyvestProvisioningRecoveryStore({
  configuration,
  execute,
}: {
  configuration: unknown;
  execute: PiggyvestProvisioningExecutor;
}) {
  const parsed = schemas.configuration.safeParse(configuration);
  if (!parsed.success || typeof execute !== 'function') {
    throw new Error('PiggyVest recovery storage unavailable');
  }
  const config = parsed.data;
  function parameters(input: unknown) {
    const scope = schemas.scope.parse(input);
    return [
      config.integrationId,
      config.expectedMerchantId,
      scope.customerId,
      scope.goalId,
      scope.intentId,
      config.expectedBusinessId,
    ];
  }
  return {
    async readCustomerMapping(input: unknown) {
      try {
        const customerId = schemas.customerId.parse(input);
        const response = await execute(statements.readCustomerMapping.text, [
          config.integrationId,
          config.expectedMerchantId,
          customerId,
          config.expectedBusinessId,
        ]);
        return schemas.customerMapping.parse(response.rows)[0];
      } catch {
        throw new Error('PiggyVest recovery storage unavailable');
      }
    },
    async begin(input: unknown) {
      try {
        const response = await execute(
          statements.beginProvisioningVerification.text,
          parameters(input)
        );
        return schemas.verification.parse(response.rows)[0] ?? null;
      } catch {
        throw new Error('PiggyVest recovery storage unavailable');
      }
    },
    async confirm(input: unknown, token: unknown, observation: unknown) {
      try {
        const values = parameters(input);
        const verificationToken = schemas.token.parse(token);
        const wallet = schemas.observation.parse(observation);
        const response = await execute(
          statements.confirmProvisioningRecovery.text,
          [
            ...values,
            verificationToken,
            wallet.id,
            wallet.business_id,
            wallet.currency,
            wallet.status,
          ]
        );
        return schemas.confirmed.parse(response.rows)[0].outcome;
      } catch {
        throw new Error('PiggyVest recovery storage unavailable');
      }
    },
    async read(input: unknown) {
      try {
        const scope = schemas.scope.parse(input);
        const response = await execute(
          statements.readProvisioningRecovery.text,
          parameters(scope)
        );
        const row = schemas.rows.parse(response.rows)[0];
        if (!row) return null;
        if (
          row.intent_id !== scope.intentId ||
          row.merchant_id !== config.expectedMerchantId ||
          row.customer_id !== scope.customerId ||
          row.goal_id !== scope.goalId
        ) {
          throw new Error('scope mismatch');
        }
        return row;
      } catch {
        throw new Error('PiggyVest recovery storage unavailable');
      }
    },
    async observe(input: unknown, observation: unknown) {
      try {
        const values = parameters(input);
        const wallet = schemas.observation.nullable().parse(observation);
        const response = await execute(
          statements.observeProvisioningRecovery.text,
          [
            ...values,
            wallet?.id ?? null,
            wallet?.business_id ?? null,
            wallet?.currency ?? null,
            wallet?.status ?? null,
          ]
        );
        return schemas.recorded.parse(response.rows)[0].outcome;
      } catch {
        throw new Error('PiggyVest recovery storage unavailable');
      }
    },
  };
}
