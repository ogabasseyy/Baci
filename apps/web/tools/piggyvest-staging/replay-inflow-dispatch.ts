import type { BankTransferInflowSuccessEvent } from '../../src/schemas/piggyvest/events';
import type { ReplayEvent } from './replay-crypto';
import type { StoreRpc } from './replay-store';
import { DispatchQuarantine } from './replay-worker';

type InflowDispatchOutcome = 'applied' | 'duplicate';

type RpcError = {
  code?: unknown;
};

function isRpcError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as RpcError).code === code
  );
}

export async function dispatchReplayInflow(
  store: StoreRpc,
  event: BankTransferInflowSuccessEvent
): Promise<InflowDispatchOutcome> {
  let outcome: unknown;
  try {
    outcome = await store.call('recognize_piggyvest_staging_inflow', {
      p_provider_transaction_id: event.eventData.transaction_id,
      p_event_data_id: event.eventData.id,
      p_event_id: event.eventId,
      p_provider_customer_id: event.customer_id,
      p_wallet_id: event.pvb_wallet,
      p_amount_kobo: event.eventData.amount,
      p_fee_kobo: event.eventData.fee,
      p_reference: event.eventData.reference,
      p_session_id: event.eventData.session_id ?? null,
      p_credited_at: event.eventData.timestamp,
    });
  } catch (error) {
    if (isRpcError(error, '23505')) {
      throw new DispatchQuarantine({
        eventId: event.eventId,
        reason: 'conflict',
      });
    }
    if (isRpcError(error, '22023')) {
      throw new DispatchQuarantine({
        eventId: event.eventId,
        reason: 'poison',
      });
    }
    throw error;
  }

  if (outcome === 'recognized') return 'applied';
  if (outcome === 'duplicate') return 'duplicate';
  throw new DispatchQuarantine({
    eventId: event.eventId,
    reason: 'poison',
  });
}

export function isReplayInflowEvent(
  event: ReplayEvent
): event is BankTransferInflowSuccessEvent {
  return event.eventType === 'bank-transfer.inflow.success';
}
