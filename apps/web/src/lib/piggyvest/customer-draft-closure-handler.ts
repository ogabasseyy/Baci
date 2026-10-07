import 'server-only';
import type { NextRequest } from 'next/server';
import { piggyvestCustomerDraftClosureSchemas as schemas } from '@/schemas/piggyvest-customer-draft-closure';
import { createPiggyvestCustomerOperationHandler } from './customer-operation-handler';
import { DRAFT_CLOSURE_STATEMENTS as statements } from './draft-closure-statements';

export function createPiggyvestCustomerDraftClosureHandler(
  options: Parameters<typeof createPiggyvestCustomerOperationHandler>[0]
) {
  const handle = createPiggyvestCustomerOperationHandler(options);
  function run(request: NextRequest, method: 'GET' | 'POST') {
    return handle(request, {
      method,
      schema: method === 'GET' ? schemas.readSelection : schemas.closeSelection,
      uncertain: (input) => ({
        status: 'unconfirmed',
        goalId: input.goalId,
        readbackRequired: true,
      }),
      run: async (input, context) => {
        const command = input.command;
        const statement = command
          ? statements.closeUnfundedDraft
          : statements.readDraftClosure;
        const { scope, actorId } = context;
        const parameters = [
          scope.integrationId,
          scope.merchantId,
          scope.customerId,
          scope.goalId,
          scope.expectedBusinessId,
          actorId,
          ...(command ? [JSON.stringify(command)] : []),
        ];
        const execute = context.execute(
          (text, values) =>
            text === statement.text &&
            JSON.stringify(values) === JSON.stringify(parameters)
        );
        const { rows } = await execute(statement.text, parameters);
        const result = schemas.rows.parse(rows)[0].result;
        if (result.goalId !== input.goalId) throw new Error('Unavailable');
        if (
          command &&
          result.status === 'closed' &&
          (result.operationId.toLowerCase() !==
            command.operationId.toLowerCase() ||
            result.revisionId.toLowerCase() !==
              command.revisionId.toLowerCase() ||
            result.termsVersion !== command.termsVersion ||
            result.termsHash !== command.termsHash)
        )
          throw new Error('Unavailable');
        return result;
      },
    });
  }
  return {
    GET: (request: NextRequest) => run(request, 'GET'),
    POST: (request: NextRequest) => run(request, 'POST'),
  };
}
