import 'server-only';
import { piggyvestGoalLifecycleSchemas } from '@/schemas/piggyvest-goal-lifecycle';
import { piggyvestGoalPolicySchemas as schemas } from '@/schemas/piggyvest-goal-policy';
import { GOAL_LIFECYCLE_STATEMENTS } from './goal-lifecycle-statements';
import { GOAL_POLICY_STATEMENTS as statements } from './goal-policy-store-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function createGoalPolicyStore({
  configuration,
  execute,
}: {
  configuration: unknown;
  execute: PiggyvestProvisioningExecutor;
}) {
  const parsed = schemas.configuration.safeParse(configuration);
  if (!parsed.success || typeof execute !== 'function')
    throw new Error('Goal policy storage unavailable');
  const config = parsed.data;
  const scope = [
    config.integrationId,
    config.merchantId,
    config.customerId,
    config.goalId,
    config.expectedBusinessId,
  ];
  return {
    async stage(input: unknown) {
      try {
        const command = schemas.command.parse(input);
        const response = await execute(statements.stageGoalPolicy.text, [
          ...scope,
          JSON.stringify(command),
        ]);
        const result = schemas.staged.parse(response.rows)[0].result;
        if (result.revisionId !== command.revisionId)
          throw new Error('Revision mismatch');
        return result;
      } catch {
        throw new Error('Goal policy storage unavailable');
      }
    },
    async accept(input: unknown) {
      try {
        const acceptance = schemas.acceptance.parse(input);
        if (acceptance.durationMonths !== undefined) {
          const response = await execute(
            GOAL_LIFECYCLE_STATEMENTS.acceptGoalLifecycleTerms.text,
            [
              ...scope,
              acceptance.revisionId,
              acceptance.actorId,
              acceptance.durationMonths,
            ]
          );
          const result =
            piggyvestGoalLifecycleSchemas.termsAcknowledgement.parse(
              response.rows
            )[0].result;
          if (
            result.revisionId !== acceptance.revisionId ||
            result.durationMonths !== acceptance.durationMonths ||
            result.outcome !== 'accepted'
          )
            throw new Error('Duration consent mismatch');
          return { revisionId: result.revisionId, outcome: result.outcome };
        }
        const response = await execute(statements.acceptGoalPolicy.text, [
          ...scope,
          acceptance.revisionId,
          acceptance.actorId,
        ]);
        const result = schemas.accepted.parse(response.rows)[0].result;
        if (result.revisionId !== acceptance.revisionId)
          throw new Error('Revision mismatch');
        return result;
      } catch {
        throw new Error('Goal policy storage unavailable');
      }
    },
    async read() {
      try {
        const response = await execute(statements.readGoalPolicy.text, [
          ...scope,
        ]);
        return schemas.read.parse(response.rows)[0].result;
      } catch {
        throw new Error('Goal policy storage unavailable');
      }
    },
  };
}
