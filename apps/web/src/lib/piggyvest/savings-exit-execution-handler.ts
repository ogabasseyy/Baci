import 'server-only';
import {
  type SavingsExitAction,
  savingsExitExecutionSchemas as schemas,
} from '@/schemas/savings-exit-execution';
import { createPiggyvestCustomerOperationHandler } from './customer-operation-handler';
import { createSavingsExitExecution } from './savings-exit-execution';
import { SAVINGS_EXIT_EXECUTION_STATEMENTS as statements } from './savings-exit-execution-statements';

type TransferProvider = Parameters<
  typeof createSavingsExitExecution
>[0]['transferProvider'];

export function createSavingsExitExecutionHandler(
  options: Parameters<typeof createPiggyvestCustomerOperationHandler>[0] & {
    action: SavingsExitAction;
    policy?: unknown;
    transferProvider: TransferProvider;
  }
) {
  const handle = createPiggyvestCustomerOperationHandler(options);
  return {
    POST: (request: Parameters<typeof handle>[0]) =>
      handle(request, {
        method: 'POST',
        schema: schemas.request,
        uncertain: (input) => ({
          status: 'pending_verification',
          operationId: input.operationId,
        }),
        run: async (input, context) =>
          createSavingsExitExecution({
            configuration: {
              integrationId: context.scope.integrationId,
              merchantId: context.scope.merchantId,
              customerId: context.scope.customerId,
              goalId: context.scope.goalId,
              expectedBusinessId: context.scope.expectedBusinessId,
              actorId: context.actorId,
            },
            policy: options.policy,
            action: options.action,
            transferProvider: options.transferProvider,
            execute: context.execute(
              (statement, parameters) =>
                ((statement === statements.begin.text &&
                  parameters.length === 9 &&
                  parameters[7] === options.action) ||
                  (statement === statements.recordFinality.text &&
                    parameters.length === 8) ||
                  (statement === statements.exitConsumeEvidence.text &&
                    parameters.length === 8 &&
                    parameters[7] === options.action)) &&
                parameters[5] === context.actorId &&
                parameters[6] === input.operationId
            ),
          }).execute({ operationId: input.operationId }),
      }),
  };
}
