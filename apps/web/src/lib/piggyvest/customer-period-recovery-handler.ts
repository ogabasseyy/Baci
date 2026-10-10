import 'server-only';
import type { NextRequest } from 'next/server';
import { piggyvestCustomerPeriodRecoverySchemas as schemas } from '@/schemas/piggyvest-customer-period-recovery';
import { createPiggyvestCustomerOperationHandler } from './customer-operation-handler';
import { createPeriodRecovery } from './period-recovery';
import { PERIOD_RECOVERY_STATEMENTS } from './period-recovery-statements';

export function createPiggyvestCustomerPeriodRecoveryHandler(
  options: Parameters<typeof createPiggyvestCustomerOperationHandler>[0]
) {
  const handle = createPiggyvestCustomerOperationHandler(options);
  return {
    GET: (request: NextRequest) =>
      handle(request, {
        method: 'GET',
        schema: schemas.selection,
        uncertain: () => ({ error: 'Period recovery unavailable' }),
        run: async (input, context) => {
          const { scope, actorId } = context;
          const parameters = [
            scope.integrationId,
            scope.merchantId,
            scope.customerId,
            scope.goalId,
            scope.expectedBusinessId,
            actorId,
            input.ledgerOperationId,
          ];
          const store = createPeriodRecovery({
            configuration: { ...scope, transport: 'local_test', actorId },
            execute: context.execute(
              (text, values) =>
                text === PERIOD_RECOVERY_STATEMENTS.readPeriodRecovery.text &&
                JSON.stringify(values) === JSON.stringify(parameters)
            ),
          });
          const result = await store.read({
            ledgerOperationId: input.ledgerOperationId,
          });
          return schemas.response.parse({
            goalId: result.goalId,
            ledgerOperationId: result.ledgerOperationId,
            metadataRecorded: result.record !== null,
            kind: result.canonical.kind,
            originalCreditKobo: result.canonical.originalCreditKobo,
            reversed: result.canonical.reversalOperationId !== null,
            evidence: result.canonical.evidence,
            periodStatus: result.periodStatus,
            coveredPeriod: result.coveredPeriod,
            entitlement: result.entitlement,
            disposition: result.disposition,
            financialEffects: result.financialEffects,
            fundsUse: result.fundsUse,
          });
        },
      }),
  };
}
