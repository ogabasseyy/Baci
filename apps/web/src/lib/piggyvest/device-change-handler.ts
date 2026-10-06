import 'server-only';
import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { deviceChangeSchemas as schemas } from '@/schemas/device-change';
import { createPiggyvestCustomerOperationHandler } from './customer-operation-handler';
import { DEVICE_CHANGE_STATEMENTS as statements } from './device-change-statements';

export function createPiggyvestDeviceChangeHandler(
  options: Parameters<typeof createPiggyvestCustomerOperationHandler>[0] & {
    termsDocument: unknown;
  }
) {
  const handle = createPiggyvestCustomerOperationHandler(options);
  const uncertain = (input: { goalId: string }) => ({
    status: 'unavailable',
    goalId: input.goalId,
    readbackRequired: true,
    dispatch: 'disabled',
  });
  const terms = () => {
    const document = schemas.terms.parse(options.termsDocument);
    if (
      createHash('sha256').update(document.text).digest('hex') !== document.hash
    )
      throw new Error('Device change unavailable');
    return document;
  };
  return {
    quote: (request: NextRequest) =>
      handle(request, {
        method: 'POST',
        schema: schemas.selection,
        uncertain,
        run: async (input, context) => {
          const document = terms();
          const command = JSON.stringify({
            quoteId: input.quoteId,
            productId: input.productId,
            variantId: input.variantId,
          });
          const execute = context.execute(
            (statement, parameters) =>
              statement === statements.publishDeviceChange.text &&
              parameters.length === 7 &&
              parameters[5] === context.actorId &&
              parameters[6] === command
          );
          const scope = context.scope;
          const response = await execute(statements.publishDeviceChange.text, [
            scope.integrationId,
            scope.merchantId,
            scope.customerId,
            scope.goalId,
            scope.expectedBusinessId,
            context.actorId,
            command,
          ]);
          const quote = schemas.quoteRows.parse(response.rows)[0].result;
          if (
            quote.goalId !== input.goalId ||
            quote.quoteId !== input.quoteId ||
            quote.device.productId !== input.productId ||
            quote.device.variantId !== input.variantId ||
            quote.termsVersion !== document.version ||
            quote.termsHash !== document.hash
          )
            throw new Error('Device change unavailable');
          return { status: 'quote_available', quote, terms: document };
        },
      }),
    confirm: (request: NextRequest) =>
      handle(request, {
        method: 'POST',
        schema: schemas.confirmation,
        uncertain,
        run: async (input, context) => {
          if (input.quote.goalId !== input.goalId)
            throw new Error('Device change unavailable');
          const command = JSON.stringify({
            operationId: input.operationId,
            quote: input.quote,
            accepted: input.accepted,
          });
          const execute = context.execute(
            (statement, parameters) =>
              statement === statements.confirmDeviceChange.text &&
              parameters.length === 7 &&
              parameters[5] === context.actorId &&
              parameters[6] === command
          );
          const scope = context.scope;
          const response = await execute(statements.confirmDeviceChange.text, [
            scope.integrationId,
            scope.merchantId,
            scope.customerId,
            scope.goalId,
            scope.expectedBusinessId,
            context.actorId,
            command,
          ]);
          const receipt = schemas.receiptRows.parse(response.rows)[0].result;
          const { expiresAt: _expiresAt, ...reviewed } = input.quote;
          for (const [key, value] of Object.entries(reviewed)) {
            if (
              JSON.stringify(receipt[key as keyof typeof receipt]) !==
              JSON.stringify(value)
            )
              throw new Error('Device change receipt unavailable');
          }
          if (receipt.operationId !== input.operationId)
            throw new Error('Device change receipt unavailable');
          return receipt;
        },
      }),
    status: (request: NextRequest) =>
      handle(request, {
        method: 'GET',
        schema: schemas.lookup,
        uncertain,
        run: async (input, context) => {
          const execute = context.execute(
            (statement, parameters) =>
              statement === statements.readDeviceChange.text &&
              parameters.length === 7 &&
              parameters[5] === context.actorId &&
              parameters[6] === input.operationId
          );
          const scope = context.scope;
          const response = await execute(statements.readDeviceChange.text, [
            scope.integrationId,
            scope.merchantId,
            scope.customerId,
            scope.goalId,
            scope.expectedBusinessId,
            context.actorId,
            input.operationId,
          ]);
          const receipt = schemas.receiptRows.parse(response.rows)[0].result;
          if (
            receipt.goalId !== input.goalId ||
            receipt.operationId !== input.operationId
          )
            throw new Error('Device change receipt unavailable');
          return { status: 'historical', receipt };
        },
      }),
  };
}
