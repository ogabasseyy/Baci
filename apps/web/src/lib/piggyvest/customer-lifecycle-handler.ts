import 'server-only';
import type { NextRequest } from 'next/server';
import { piggyvestCustomerLifecycleHandlerSchemas as schemas } from '@/schemas/piggyvest-customer-lifecycle-handler';
import { createPiggyvestCustomerOperationHandler } from './customer-operation-handler';
import { activatePiggyvestGoalLifecycle } from './goal-lifecycle';
import { GOAL_LIFECYCLE_STATEMENTS } from './goal-lifecycle-statements';
import { recordPiggyvestGoalLifecycleTerms } from './goal-lifecycle-terms';
import { createGoalPolicyStore } from './goal-policy-store';
import { GOAL_POLICY_STATEMENTS } from './goal-policy-store-statements';

export function createPiggyvestCustomerLifecycleHandler(
  options: Parameters<typeof createPiggyvestCustomerOperationHandler>[0]
) {
  const handle = createPiggyvestCustomerOperationHandler(options);
  return {
    terms: (request: NextRequest) =>
      handle(request, {
        method: 'POST',
        schema: schemas.terms,
        uncertain: (input) => ({
          status: 'unavailable',
          goalId: input.goalId,
          revisionId: input.revisionId,
          outcome: 'indeterminate',
        }),
        run: async (input, context) => {
          const result = await recordPiggyvestGoalLifecycleTerms(
            {
              enabled: true,
              transport: 'local_test',
              scope: context.scope,
              command: {
                action: 'prepare',
                revisionId: input.revisionId,
                durationMonths: input.durationMonths,
              },
            },
            context.execute(
              (statement, parameters) =>
                statement ===
                  GOAL_LIFECYCLE_STATEMENTS.prepareGoalLifecycleTerms.text &&
                parameters.length === 7 &&
                parameters[5] === input.revisionId &&
                parameters[6] === input.durationMonths
            )
          );
          return { ...result, goalId: input.goalId, consent: 'required' };
        },
      }),
    activate: (request: NextRequest) =>
      handle(request, {
        method: 'POST',
        schema: schemas.activate,
        uncertain: (input) => ({
          status: 'unavailable',
          goalId: input.goalId,
          revisionId: input.revisionId,
          operationId: input.operationId,
          outcome: 'indeterminate',
        }),
        run: async (input, context) => {
          const store = createGoalPolicyStore({
            configuration: context.scope,
            execute: context.execute(
              (statement, parameters) =>
                statement === GOAL_POLICY_STATEMENTS.readGoalPolicy.text &&
                parameters.length === 5
            ),
          });
          const policy = await store.read();
          if (
            !policy ||
            policy.actorId !== context.actorId ||
            policy.acceptedAt === null ||
            policy.durationMonths === undefined ||
            policy.revisionId !== input.revisionId
          )
            throw new Error('Unavailable');
          const result = await activatePiggyvestGoalLifecycle(
            {
              enabled: true,
              transport: 'local_test',
              scope: context.scope,
              command: {
                revisionId: input.revisionId,
                operationId: input.operationId,
              },
            },
            context.execute(
              (statement, parameters) =>
                statement ===
                  GOAL_LIFECYCLE_STATEMENTS.activateGoalLifecycle.text &&
                parameters.length === 7 &&
                parameters[5] === input.revisionId &&
                parameters[6] === input.operationId
            )
          );
          return { ...result, goalId: input.goalId };
        },
      }),
  };
}
