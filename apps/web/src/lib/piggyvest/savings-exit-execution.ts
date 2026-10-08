import 'server-only';
import {
  type SavingsExitAction,
  type SavingsExitTransfer,
  savingsExitExecutionSchemas as schemas,
} from '@/schemas/savings-exit-execution';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import { SAVINGS_EXIT_EXECUTION_STATEMENTS as statements } from './savings-exit-execution-statements';

type ProviderFinality = SavingsExitTransfer & {
  status: 'success' | 'pending' | 'failed' | 'unknown';
};

function sameTransfer(
  expected: SavingsExitTransfer,
  actual: ProviderFinality
): boolean {
  return (
    actual.operationId === expected.operationId &&
    actual.reference === expected.reference &&
    actual.sourceWalletId === expected.sourceWalletId &&
    actual.destinationWalletId === expected.destinationWalletId &&
    actual.amountKobo === expected.amountKobo &&
    actual.currency === expected.currency &&
    actual.action === expected.action
  );
}

export function createSavingsExitExecution(options: {
  configuration: unknown;
  execute: PiggyvestProvisioningExecutor;
  action: SavingsExitAction;
  policy?: unknown;
  transferProvider: {
    submit: (transfer: SavingsExitTransfer) => Promise<{
      status: 'pending' | 'unknown';
    }>;
    verify: (transfer: SavingsExitTransfer) => Promise<ProviderFinality>;
  };
}) {
  const configuration = schemas.configuration.parse(options.configuration);
  const policy = options.policy
    ? schemas.policy.safeParse(options.policy)
    : null;
  const scope = [
    configuration.integrationId,
    configuration.merchantId,
    configuration.customerId,
    configuration.goalId,
    configuration.expectedBusinessId,
    configuration.actorId,
  ];

  return {
    async execute(input: unknown) {
      const command = schemas.command.parse(input);
      if (!policy?.success) {
        return {
          status: 'requires_owner_approval' as const,
          operationId: command.operationId,
        };
      }
      try {
        const consume = async () => {
          const result = schemas.accountingRows.parse(
            (
              await options.execute(statements.exitConsumeEvidence.text, [
                ...scope,
                command.operationId,
                options.action,
              ])
            ).rows
          )[0].result;
          if (result.operationId !== command.operationId) throw new Error();
          return {
            status:
              result.state === 'pending'
                ? ('pending_verification' as const)
                : result.state,
            operationId: command.operationId,
          };
        };
        const prepared = schemas.beginRows.parse(
          (
            await options.execute(statements.begin.text, [
              ...scope,
              command.operationId,
              options.action,
              JSON.stringify(policy.data),
            ])
          ).rows
        )[0].result;
        if (prepared.operationId !== command.operationId) throw new Error();
        if (prepared.state === 'deferred') {
          return {
            status: 'requires_owner_approval' as const,
            operationId: command.operationId,
          };
        }
        if (prepared.state === 'pending_projection') {
          return await consume();
        }
        if (prepared.state === 'requires_reconciliation') {
          return {
            status: 'requires_reconciliation' as const,
            operationId: command.operationId,
          };
        }
        if (!prepared.transfer || prepared.transfer.action !== options.action) {
          return {
            status: 'quarantined' as const,
            operationId: command.operationId,
          };
        }
        if (prepared.state === 'verify') {
          const recovered = await consume();
          if (recovered.status !== 'pending_verification') return recovered;
        }
        if (prepared.state === 'submit') {
          await options.transferProvider.submit(prepared.transfer);
        }
        const observed = schemas.finality.parse(
          await options.transferProvider.verify(prepared.transfer)
        );
        if (!sameTransfer(prepared.transfer, observed)) {
          return {
            status: 'quarantined' as const,
            operationId: command.operationId,
          };
        }
        if (observed.status === 'success') {
          return await consume();
        }
        const result = schemas.finalRows.parse(
          (
            await options.execute(statements.recordFinality.text, [
              ...scope,
              command.operationId,
              JSON.stringify(observed),
            ])
          ).rows
        )[0].result;
        if (result.operationId !== command.operationId) throw new Error();
        return {
          status:
            result.state === 'pending_projection'
              ? ('pending_projection' as const)
              : result.state === 'requires_reconciliation'
                ? ('requires_reconciliation' as const)
                : ('pending_verification' as const),
          operationId: command.operationId,
        };
      } catch {
        return {
          status: 'pending_verification' as const,
          operationId: command.operationId,
        };
      }
    },
  };
}
