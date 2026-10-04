import 'server-only';
import { purchaseCurrentRecoverySchemas } from '@/schemas/purchase-current-recovery';
import { purchasePreparationSchemas } from '@/schemas/purchase-preparation';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import { PURCHASE_CURRENT_RECOVERY_STATEMENTS } from './purchase-current-recovery-statements';

export function createPurchaseCurrentRecovery(options: {
  configuration: unknown;
  execute: PiggyvestProvisioningExecutor;
}) {
  const config = purchasePreparationSchemas.configuration.parse(
    options.configuration
  );
  return async (input: unknown) => {
    try {
      const { operationId } = purchasePreparationSchemas.operation.parse(input);
      const response = await options.execute(
        PURCHASE_CURRENT_RECOVERY_STATEMENTS.purchaseCurrentRecovery.text,
        [
          config.integrationId,
          config.merchantId,
          config.customerId,
          config.goalId,
          config.expectedBusinessId,
          config.actorId,
          operationId,
        ]
      );
      const result = purchaseCurrentRecoverySchemas.rows.parse(response.rows)[0]
        .result;
      if (result.operationId !== operationId) throw new Error('Unavailable');
      return result;
    } catch {
      return {
        status: 'unavailable',
        reservation: 'may_be_retained',
        dispatch: 'contract_gap',
        fulfilment: 'disabled',
      } as const;
    }
  };
}
