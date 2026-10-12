import 'server-only';
import { paymentLegRecoverySchemas as schemas } from '@/schemas/payment-leg-recovery';
import { PAYMENT_LEG_RECOVERY_STATEMENTS as statements } from './payment-leg-recovery-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function createPaymentLegRecovery(options: {
  configuration: unknown;
  execute: PiggyvestProvisioningExecutor;
}) {
  const config = schemas.configuration.parse(options.configuration);
  async function run(input: unknown, write: boolean) {
    try {
      if (!config.enabled) throw new Error('Disabled');
      const observation = write ? schemas.observation.parse(input) : null;
      const parsed = observation ?? schemas.lookup.parse(input);
      const { operationId, ...command } = parsed;
      const response = await options.execute(
        (write
          ? statements.paymentLegRecoveryObserve
          : statements.paymentLegRecoveryRead
        ).text,
        [
          config.integrationId,
          config.merchantId,
          config.customerId,
          config.goalId,
          config.expectedBusinessId,
          config.actorId,
          operationId,
          write ? JSON.stringify(command) : parsed.observationId,
        ]
      );
      const result = schemas.rows.parse(response.rows)[0].result;
      if (
        result.operationId !== operationId ||
        result.paymentLegRecovery.historicalObservation?.observationId !==
          (parsed.observationId ?? undefined)
      )
        throw new Error('Mismatch');
      const historical = result.paymentLegRecovery.historicalObservation;
      if (
        observation &&
        (!historical ||
          historical.reason !== observation.reason ||
          historical.leg !== observation.leg)
      )
        throw new Error('Mismatch');
      return result;
    } catch {
      return {
        status: 'unavailable',
        reservation: 'may_be_retained',
        dispatch: 'contract_gap',
        fulfilment: 'disabled',
      } as const;
    }
  }
  return {
    read: (input: unknown) => run(input, false),
    observe: (input: unknown) => run(input, true),
  };
}
