import 'server-only';
import type { NextRequest } from 'next/server';
import { protectedOfferSchemas as schemas } from '@/schemas/protected-offer';
import { createPiggyvestCustomerOperationHandler } from './customer-operation-handler';
import { PROTECTED_OFFER_STATEMENTS as statements } from './protected-offer-statements';

export function createPiggyvestProtectedOfferHandler(
  options: Parameters<typeof createPiggyvestCustomerOperationHandler>[0]
) {
  const handle = createPiggyvestCustomerOperationHandler(options);
  const run = (request: NextRequest, historical: boolean) =>
    handle(request, {
      method: historical ? 'GET' : 'POST',
      schema: schemas.request,
      uncertain: (input) => ({
        status: 'unavailable',
        goalId: input.goalId,
        requestedOfferId: input.offerId,
        readbackRequired: true,
        dispatch: 'disabled',
      }),
      run: async (input, context) => {
        const statement = historical
          ? statements.readProtectedOffer
          : statements.publishProtectedOffer;
        const execute = context.execute(
          (text, parameters) =>
            text === statement.text &&
            parameters.length === 7 &&
            parameters[5] === context.actorId &&
            parameters[6] === input.offerId
        );
        const scope = context.scope;
        const result = await execute(statement.text, [
          scope.integrationId,
          scope.merchantId,
          scope.customerId,
          scope.goalId,
          scope.expectedBusinessId,
          context.actorId,
          input.offerId,
        ]);
        if (historical) {
          const observation = schemas.observationRows.parse(result.rows)[0]
            .result;
          if (
            observation.receipt.goalId !== input.goalId ||
            observation.requestedOfferId !== input.offerId
          )
            throw new Error('Protected offer unavailable');
          return observation;
        }
        const receipt = schemas.rows.parse(result.rows)[0].result;
        if (receipt.goalId !== input.goalId)
          throw new Error('Protected offer unavailable');
        return { status: 'published', receipt };
      },
    });
  return {
    publish: (request: NextRequest) => run(request, false),
    status: (request: NextRequest) => run(request, true),
  };
}
