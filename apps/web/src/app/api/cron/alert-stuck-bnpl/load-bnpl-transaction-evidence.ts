import { logger } from '@/lib/logger';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { getStuckBnplSignals } from './get-stuck-bnpl-signals';
import { STUCK_BNPL_CONFIG } from './stuck-bnpl-config';

type TransactionReader = Pick<ReturnType<typeof createAdminClient>, 'from'>;
type OrderSignals = ReturnType<typeof getStuckBnplSignals>;

interface TransactionRow {
  gateway: string | null;
  gateway_reference: string | null;
  order_id: string | null;
  status: string | null;
}

export async function loadBnplTransactionEvidence(
  supabase: TransactionReader,
  signalsByOrderId: ReadonlyMap<string, OrderSignals>
) {
  const progressedOrderIds = new Set<string>();
  const referencesByOrderId = new Map<string, string>();
  const orderIds = Array.from(signalsByOrderId)
    .filter(([, signals]) => !signals.hasConfirmation)
    .map(([id]) => id);

  if (orderIds.length === 0) {
    return { progressedOrderIds, referencesByOrderId, lookupFailed: false };
  }

  const rows: TransactionRow[] = [];
  // Bound UUID filters so the encoded PostgREST URL stays small.
  const batchSize = STUCK_BNPL_CONFIG.transactionLookupBatchSize;
  let lookupFailed = false;
  for (let offset = 0; offset < orderIds.length; offset += batchSize) {
    const { data, error } = await supabase
      .from('transactions')
      .select('order_id, status, gateway, gateway_reference')
      .in('order_id', orderIds.slice(offset, offset + batchSize));
    if (error) {
      logger.warn({
        message:
          'Stuck-BNPL transaction evidence was unavailable for a batch; orders requiring that evidence may be omitted',
        error,
        orderIds: orderIds.slice(offset, offset + batchSize),
      });
      lookupFailed = true;
      continue;
    }
    rows.push(...((data ?? []) as TransactionRow[]));
  }

  let unknownGatewayCount = 0;
  const ambiguousReferenceOrders = new Set<string>();
  for (const row of rows) {
    if (
      !row.order_id ||
      (row.status !== 'processing' && row.status !== 'completed')
    )
      continue;

    const signals = signalsByOrderId.get(row.order_id);
    if (!signals || signals.hasConfirmation) continue;

    const gateway = row.gateway?.trim().toLowerCase();
    if (!gateway) {
      unknownGatewayCount++;
      continue;
    }
    if (gateway !== signals.provider) continue;

    const reference = row.gateway_reference?.trim();
    if (!reference) continue;
    const { attempt } = signals;
    if (
      gateway === 'credit_direct' &&
      (attempt.supersededReferences.includes(reference) ||
        (attempt.reference !== null && reference !== attempt.reference))
    ) {
      continue;
    }

    progressedOrderIds.add(row.order_id);
    if (ambiguousReferenceOrders.has(row.order_id)) continue;
    const previousReference = referencesByOrderId.get(row.order_id);
    if (previousReference && previousReference !== reference) {
      referencesByOrderId.delete(row.order_id);
      ambiguousReferenceOrders.add(row.order_id);
    } else {
      referencesByOrderId.set(row.order_id, reference);
    }
  }
  if (unknownGatewayCount > 0) {
    logger.warn({
      message:
        'Stuck-BNPL scan ignored progressed transactions without a gateway',
      unknownGatewayCount,
    });
  }
  return { progressedOrderIds, referencesByOrderId, lookupFailed };
}
