import 'server-only';
import { piggyvestPeriodRecoverySchemas as schemas } from '@/schemas/piggyvest-period-recovery';
import { PERIOD_RECOVERY_STATEMENTS as statements } from './period-recovery-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function createPeriodRecovery(options: {
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
  function verify(
    receipt: ReturnType<typeof schemas.receipt.parse>,
    ledgerOperationId: string
  ) {
    if (
      receipt.goalId !== config.goalId ||
      receipt.ledgerOperationId !== ledgerOperationId ||
      receipt.recordedByActorId !== config.actorId
    )
      throw new Error();
  }
  return {
    async record(input: unknown) {
      const parsed = schemas.command.safeParse(input);
      if (!parsed.success) throw new Error('Period recovery unavailable');
      const { ledgerOperationId } = parsed.data;
      try {
        const result = await options.execute(
          statements.recordPeriodRecovery.text,
          [...parameters, ledgerOperationId]
        );
        const receipt = schemas.writeRows.parse(result.rows)[0].result;
        verify(receipt, ledgerOperationId);
        return { status: 'recorded_metadata' as const, receipt };
      } catch {
        return {
          status: 'unconfirmed' as const,
          ledgerOperationId,
          readbackRequired: true as const,
          fundsUse: 'not_authorized' as const,
        };
      }
    },
    async read(input: unknown) {
      try {
        const { ledgerOperationId } = schemas.command.parse(input);
        const result = await options.execute(
          statements.readPeriodRecovery.text,
          [...parameters, ledgerOperationId]
        );
        const snapshot = schemas.readRows.parse(result.rows)[0].result;
        if (
          snapshot.goalId !== config.goalId ||
          snapshot.ledgerOperationId !== ledgerOperationId
        )
          throw new Error();
        if (snapshot.record) verify(snapshot.record, ledgerOperationId);
        return snapshot;
      } catch {
        throw new Error('Period recovery unavailable');
      }
    },
  };
}
