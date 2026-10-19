import 'server-only';
import type { NextRequest } from 'next/server';
import { reconciliationCasesSchemas as schemas } from '@/schemas/reconciliation-cases';
import { createPiggyvestCustomerOperationHandler } from './customer-operation-handler';
import { RECONCILIATION_CASES_STATEMENTS as statements } from './reconciliation-cases-statements';

export function createReconciliationCasesHandler(
  options: Parameters<typeof createPiggyvestCustomerOperationHandler>[0]
) {
  const handle = createPiggyvestCustomerOperationHandler(options);
  return {
    GET: (request: NextRequest) =>
      handle(request, {
        method: 'GET',
        schema: schemas.request,
        uncertain: (input) => ({
          status: 'unavailable',
          goalId: input.goalId,
          financialEffects: 'UNKNOWN',
          fundsUse: 'not_authorized',
          dispatch: 'disabled',
        }),
        run: async (input, context) => {
          const single = 'collectionOperationId' in input;
          const identifier = single ? input.collectionOperationId : input.after;
          const statement = single
            ? statements.readReconciliationCase
            : statements.listReconciliationCases;
          const execute = context.execute(
            (text, parameters) =>
              text === statement.text &&
              parameters.length === 7 &&
              parameters[5] === context.actorId &&
              parameters[6] === identifier
          );
          const scope = context.scope;
          const result = await execute(statement.text, [
            scope.integrationId,
            scope.merchantId,
            scope.customerId,
            scope.goalId,
            scope.expectedBusinessId,
            context.actorId,
            identifier,
          ]);
          if (single) {
            const value = schemas.readRows.parse(result.rows)[0].result;
            if (value.goalId !== input.goalId || value.caseId !== identifier)
              throw new Error('Case unavailable');
            return value;
          }
          const value = schemas.listRows.parse(result.rows)[0].result;
          if (
            value.goalId !== input.goalId ||
            value.cases.some(
              (entry) => identifier !== null && entry.caseId <= identifier
            )
          )
            throw new Error('Cases unavailable');
          return value;
        },
      }),
  };
}
