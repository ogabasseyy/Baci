import 'server-only';
import { piggyvestCollectionReconciliationSchemas as schemas } from '@/schemas/piggyvest-collection-reconciliation';
import { COLLECTION_RECONCILIATION_STATEMENTS as statements } from './collection-reconciliation-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function createCollectionReconciliation(options: {
  configuration: unknown;
  execute: PiggyvestProvisioningExecutor;
}) {
  const config = schemas.configuration.parse(options.configuration);
  const parameters = [
    config.integrationId,
    config.merchantId,
    config.customerId,
    config.goalId,
    config.expectedBusinessId,
    config.actorId,
  ];
  return {
    async observe(input: unknown) {
      const parsed = schemas.command.safeParse(input);
      if (!parsed.success)
        throw new Error('Collection reconciliation unavailable');
      const command = parsed.data;
      try {
        const result = await options.execute(
          statements.observeCollectionReconciliation.text,
          [...parameters, JSON.stringify(command)]
        );
        const receipt = schemas.writeRows.parse(result.rows)[0].result;
        if (
          receipt.operationId !== command.operationId ||
          receipt.observationId !== command.observationId ||
          receipt.goalId !== config.goalId
        )
          throw new Error('Receipt mismatch');
        return { status: 'persisted_observation' as const, receipt };
      } catch {
        return {
          status: 'unconfirmed' as const,
          operationId: command.operationId,
          observationId: command.observationId,
          readbackRequired: true as const,
          debitPermission: false as const,
        };
      }
    },
    async read(input: unknown) {
      try {
        const lookup = schemas.lookup.parse(input);
        const result = await options.execute(
          statements.readCollectionReconciliation.text,
          [...parameters, lookup.operationId, lookup.observationId]
        );
        const snapshot = schemas.readRows.parse(result.rows)[0].result;
        if (
          snapshot.operationId !== lookup.operationId ||
          snapshot.goalId !== config.goalId ||
          (snapshot.historical &&
            (snapshot.historical.operationId !== lookup.operationId ||
              snapshot.historical.observationId !== lookup.observationId ||
              snapshot.historical.goalId !== config.goalId))
        )
          throw new Error('Read mismatch');
        return snapshot;
      } catch {
        throw new Error('Collection reconciliation unavailable');
      }
    },
  };
}
