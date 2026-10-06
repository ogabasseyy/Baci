import 'server-only';
import { piggyvestCustomerLifecycleHandlerSchemas } from '@/schemas/piggyvest-customer-lifecycle-handler';
import { piggyvestGoalLifecycleSchemas as schemas } from '@/schemas/piggyvest-goal-lifecycle';
import { GOAL_LIFECYCLE_STATEMENTS } from './goal-lifecycle-statements';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export async function activatePiggyvestGoalLifecycle(
  input: unknown,
  injected?: PiggyvestProvisioningExecutor
) {
  try {
    const parsed =
      injected === undefined
        ? schemas.input.parse(input)
        : piggyvestCustomerLifecycleHandlerSchemas.boundActivation.parse(input);
    const { scope, command } = parsed;
    const execute =
      injected ??
      createPiggyvestPostgresExecutor(
        'database' in parsed ? parsed.database : undefined
      );
    const response = await execute(
      GOAL_LIFECYCLE_STATEMENTS.activateGoalLifecycle.text,
      [
        scope.integrationId,
        scope.merchantId,
        scope.customerId,
        scope.goalId,
        scope.expectedBusinessId,
        command.revisionId,
        command.operationId,
      ]
    );
    const receipt = schemas.acknowledgement.parse(response.rows)[0].result;
    if (
      receipt.operationId !== command.operationId ||
      receipt.revisionId !== command.revisionId
    )
      throw new Error('Mismatched activation');
    return receipt;
  } catch {
    throw new Error('Goal lifecycle unavailable');
  }
}
