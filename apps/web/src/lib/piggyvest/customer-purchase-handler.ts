import 'server-only';
import type { NextRequest } from 'next/server';
import { piggyvestCustomerPurchaseHandlerSchemas as schemas } from '@/schemas/piggyvest-customer-purchase-handler';
import { createPiggyvestCustomerOperationHandler } from './customer-operation-handler';
import { createPaymentLegRecovery } from './payment-leg-recovery';
import { PAYMENT_LEG_RECOVERY_STATEMENTS } from './payment-leg-recovery-statements';
import { createPurchaseCurrentRecovery } from './purchase-current-recovery';
import { PURCHASE_CURRENT_RECOVERY_STATEMENTS } from './purchase-current-recovery-statements';
import { createPurchasePreparation } from './purchase-preparation';
import { PURCHASE_PREPARATION_STATEMENTS } from './purchase-preparation-statements';
import { createAuthenticatedPurchasePricing } from './purchase-pricing';
import { PURCHASE_PRICING_STATEMENTS } from './purchase-pricing-statements';

export function createPiggyvestCustomerPurchaseHandler(
  options: Parameters<typeof createPiggyvestCustomerOperationHandler>[0] & {
    paymentLegRecovery?: { enabled: true };
  }
) {
  const handle = createPiggyvestCustomerOperationHandler(options);
  const uncertain = (input: { goalId: string; operationId: string }) => ({
    status: 'unavailable',
    goalId: input.goalId,
    operationId: input.operationId,
    reservation: 'may_be_retained',
    dispatch: 'contract_gap',
    fulfilment: 'disabled',
  });
  return {
    quote: (request: NextRequest) =>
      handle(request, {
        method: 'POST',
        schema: schemas.quote,
        uncertain: () => ({ status: 'unavailable' }),
        run: async (input, context) => {
          const pricing = createAuthenticatedPurchasePricing({
            ...options,
            execute: context.execute(
              (statement, parameters) =>
                statement ===
                  PURCHASE_PRICING_STATEMENTS.purchasePublish.text &&
                parameters.length === 6 &&
                typeof parameters[5] === 'string' &&
                JSON.parse(parameters[5]).actorId === context.actorId
            ),
          });
          const result = await pricing.publish({
            quoteId: input.quoteId,
            shippingRateId: input.shippingRateId,
            savingsKobo: input.savingsKobo,
          });
          return { ...result, goalId: input.goalId };
        },
      }),
    prepare: (request: NextRequest) =>
      handle(request, {
        method: 'POST',
        schema: schemas.prepare,
        uncertain,
        run: async (input, context) => {
          const command = {
            operationId: input.operationId,
            actorId: context.actorId,
            accepted: input.accepted,
            quote: input.quote,
          };
          const plan = createPurchasePreparation({
            configuration: {
              ...context.scope,
              transport: 'local_test',
              actorId: context.actorId,
            },
            execute: context.execute(
              (statement, parameters) =>
                statement ===
                  PURCHASE_PREPARATION_STATEMENTS.purchasePrepare.text &&
                parameters.length === 6 &&
                parameters[5] === JSON.stringify(command)
            ),
          });
          const result = await plan.prepare({
            operationId: input.operationId,
            accepted: input.accepted,
            quote: input.quote,
          });
          return {
            ...result,
            goalId: input.goalId,
            operationId: input.operationId,
          };
        },
      }),
    status: (request: NextRequest) =>
      handle(request, {
        method: 'GET',
        schema: schemas.status,
        uncertain,
        run: async (input, context) => {
          const read = createPurchaseCurrentRecovery({
            configuration: {
              ...context.scope,
              transport: 'local_test',
              actorId: context.actorId,
            },
            execute: context.execute(
              (statement, parameters) =>
                statement ===
                  PURCHASE_CURRENT_RECOVERY_STATEMENTS.purchaseCurrentRecovery
                    .text &&
                parameters.length === 7 &&
                parameters[5] === context.actorId &&
                parameters[6] === input.operationId
            ),
          });
          const metadata =
            options.paymentLegRecovery?.enabled === true
              ? createPaymentLegRecovery({
                  configuration: {
                    ...context.scope,
                    transport: 'local_test',
                    actorId: context.actorId,
                    enabled: true,
                  },
                  execute: context.execute(
                    (statement, parameters) =>
                      statement ===
                        PAYMENT_LEG_RECOVERY_STATEMENTS.paymentLegRecoveryRead
                          .text &&
                      parameters.length === 8 &&
                      parameters[5] === context.actorId &&
                      parameters[6] === input.operationId &&
                      parameters[7] === null
                  ),
                }).read
              : read;
          return {
            ...(await metadata({ operationId: input.operationId })),
            goalId: input.goalId,
            operationId: input.operationId,
          };
        },
      }),
  };
}
