import 'server-only';
import { piggyvestCustomerLifecycleHandlerSchemas } from '@/schemas/piggyvest-customer-lifecycle-handler';
import { piggyvestGoalLifecycleSchemas as schemas } from '@/schemas/piggyvest-goal-lifecycle';
import { GOAL_LIFECYCLE_STATEMENTS as statements } from './goal-lifecycle-statements';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export async function recordPiggyvestGoalLifecycleTerms(
  input: unknown,
  injected?: PiggyvestProvisioningExecutor
) {
  try {
    const parsed =
      injected === undefined
        ? schemas.termsInput.parse(input)
        : piggyvestCustomerLifecycleHandlerSchemas.boundTerms.parse(input);
    const { scope, command } = parsed;
    const execute =
      injected ??
      createPiggyvestPostgresExecutor(
        'database' in parsed ? parsed.database : undefined
      );
    const values = [
      scope.integrationId,
      scope.merchantId,
      scope.customerId,
      scope.goalId,
      scope.expectedBusinessId,
      command.revisionId,
    ];
    const response =
      command.action === 'prepare'
        ? await execute(statements.prepareGoalLifecycleTerms.text, [
            ...values,
            command.durationMonths,
          ])
        : await execute(statements.acceptGoalLifecycleTerms.text, [
            ...values,
            command.actorId,
            command.durationMonths,
          ]);
    const receipt = schemas.termsAcknowledgement.parse(response.rows)[0].result;
    if (
      receipt.revisionId !== command.revisionId ||
      receipt.durationMonths !== command.durationMonths ||
      receipt.outcome !==
        (command.action === 'prepare' ? 'prepared' : 'accepted')
    )
      throw new Error('Mismatched lifecycle terms');
    return receipt;
  } catch {
    throw new Error('Goal lifecycle terms unavailable');
  }
}
