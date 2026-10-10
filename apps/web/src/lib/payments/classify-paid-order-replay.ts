import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrderOutboxState } from '@/lib/payments/order-has-outbox-rows';

export interface PaidOrderReplayClassification {
  capturedOnAlreadyPaidOrder: boolean;
  healed: boolean;
  legacyPaidReplay: boolean;
  outboxState: Awaited<ReturnType<typeof getOrderOutboxState>> | null;
  shouldNotify: boolean;
  sideEffectsLookupFailed: boolean;
}

/**
 * Classify a completed capture as a fresh settlement, a same-transaction
 * replay, a capture on an already-paid order, or a legacy paid replay.
 * A same-transaction replay must not read as a new capture: when the
 * outbox names THIS transaction as the payer, the order was paid by
 * this row and a pending snapshot that set wonTransactionFlip is stale
 * (a concurrent writer completed it first). Gate only on the payer
 * evidence — not already_completed, which also holds for redelivered
 * fresh captures that still owe settlement.
 */
export async function classifyPaidOrderReplay({
  alreadyCompleted,
  orderAlreadyPaid,
  orderId,
  orderUpdated,
  redvaultDuplicate,
  supabase,
  transactionId,
  wonTransactionFlip,
}: {
  alreadyCompleted: boolean | undefined;
  orderAlreadyPaid: boolean | undefined;
  orderId: string;
  orderUpdated: boolean | undefined;
  redvaultDuplicate: boolean | undefined;
  supabase: SupabaseClient;
  transactionId: string;
  wonTransactionFlip: boolean;
}): Promise<PaidOrderReplayClassification> {
  const healed = Boolean(alreadyCompleted && orderUpdated);
  const outboxState = orderUpdated
    ? null
    : await getOrderOutboxState(supabase, orderId);
  const sideEffectsLookupFailed = Boolean(
    orderAlreadyPaid && !orderUpdated && outboxState?.lookupFailed
  );
  const sameTransactionReplay =
    outboxState?.hasRows === true &&
    outboxState?.payerTransactionId === transactionId;
  const capturedOnAlreadyPaidOrder =
    Boolean(orderAlreadyPaid) &&
    !orderUpdated &&
    ((!redvaultDuplicate && wonTransactionFlip && !sameTransactionReplay) ||
      (Boolean(outboxState?.hasRows) &&
        outboxState?.payerTransactionId !== transactionId));
  const legacyPaidReplay =
    Boolean(orderAlreadyPaid) &&
    !orderUpdated &&
    !wonTransactionFlip &&
    outboxState?.hasRows === false;

  const shouldNotify =
    Boolean(orderUpdated) ||
    (!capturedOnAlreadyPaidOrder && Boolean(outboxState?.onlyUntouchedSeed));

  return {
    capturedOnAlreadyPaidOrder,
    healed,
    legacyPaidReplay,
    outboxState,
    shouldNotify,
    sideEffectsLookupFailed,
  };
}
