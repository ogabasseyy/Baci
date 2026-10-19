import { DispatchQuarantine } from './replay-worker';
import { replayFinancialSchemas } from './schemas/replay-financial';
import { replayWalletOutflowSchema } from './schemas/replay-wallet-outflow';
import { replayOutflowTerminalEventSchema } from './schemas/transfer-reconciliation';
import type { DurableOutflowStore } from './transfer-outbox-finality';
import { reconcileVerifiedOutflowTerminal } from './transfer-reconciliation';

export function createOutflowReplay(
  scope: unknown,
  store: DurableOutflowStore
) {
  const config = replayFinancialSchemas.scope.parse(scope);
  return async (input: unknown): Promise<'applied' | 'duplicate'> => {
    const parsed = replayOutflowTerminalEventSchema.safeParse(input);
    if (
      !parsed.success ||
      parsed.data.eventType !== 'wallet-transfer.outflow.success'
    ) {
      throw new Error('Outflow replay deferred');
    }
    const event = parsed.data;
    const details = replayWalletOutflowSchema.safeParse(event.eventData);
    if (!details.success) throw new Error('Outflow replay deferred');
    const data = details.data;
    if (
      (data.customer_id !== undefined &&
        data.customer_id !== event.customer_id) ||
      (data.business_id !== undefined && data.business_id !== config.businessId)
    ) {
      throw new DispatchQuarantine({
        eventId: event.eventId,
        reason: 'conflict',
      });
    }
    try {
      const expected = await store.findExpected({
        reference: data.reference,
        providerCustomerId: event.customer_id,
      });
      if (!expected) throw new Error('Outflow replay deferred');
      const outcome = await reconcileVerifiedOutflowTerminal(
        {
          expected,
          terminalStatus: 'succeeded',
          evidence: {
            integrationId: config.integrationId,
            businessId: config.businessId,
            providerCustomerId: event.customer_id,
            reference: data.reference,
            amountKobo: data.amount,
            currency: data.currency,
            sourceWalletId: data.source_wallet_id,
            destinationWalletId: data.destination_wallet_id,
            providerTransactionId: data.transaction_id,
            direction: 'wallet',
          },
        },
        store
      );
      if (outcome.outcome === 'applied' || outcome.outcome === 'duplicate')
        return outcome.outcome;
      if (
        outcome.outcome === 'terminal-conflict' ||
        (outcome.outcome === 'unresolved' &&
          outcome.reason.endsWith('-mismatch'))
      ) {
        throw new DispatchQuarantine({
          eventId: event.eventId,
          reason: 'conflict',
        });
      }
      throw new Error('Outflow replay deferred');
    } catch (error) {
      if (error instanceof DispatchQuarantine) throw error;
      throw new Error('Outflow replay deferred');
    }
  };
}
