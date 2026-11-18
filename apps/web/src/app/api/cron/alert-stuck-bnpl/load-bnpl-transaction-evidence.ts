import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { Database } from '@/types/supabase';
import type { getStuckBnplSignals } from './get-stuck-bnpl-signals';
import { STUCK_BNPL_CONFIG } from './stuck-bnpl-config';

type TransactionReader = Pick<SupabaseClient<Database>, 'from'>;
type OrderSignals = ReturnType<typeof getStuckBnplSignals>;

interface TransactionRow {
  id: string;
  gateway: string | null;
  gateway_reference: string | null;
  order_id: string | null;
  status: string | null;
}

async function readTransactionBatch(
  supabase: TransactionReader,
  orderIds: string[]
): Promise<TransactionRow[] | null> {
  const rows: TransactionRow[] = [];
  let cursor: string | undefined;
  while (true) {
    let query = supabase
      .from('transactions')
      .select('id, order_id, status, gateway, gateway_reference')
      .in('order_id', orderIds)
      .in('status', ['processing', 'completed'])
      .order('id', { ascending: true })
      .limit(STUCK_BNPL_CONFIG.transactionLookupPageSize);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) {
      logger.warn({
        message:
          'Stuck-BNPL transaction evidence was unavailable for a batch; orders requiring that evidence may be omitted',
        error,
        orderIds,
      });
      return null;
    }
    const page: TransactionRow[] = data ?? [];
    // Even a short page may have hit a lower API row cap. Only an empty page
    // proves completion; keyset ordering avoids offset shifts between requests.
    if (page.length === 0) return rows;
    const nextCursor = page.at(-1)?.id;
    if (!nextCursor || (cursor && nextCursor <= cursor)) {
      logger.warn({
        message: 'Stuck-BNPL transaction evidence pagination did not advance',
        orderIds,
      });
      return null;
    }
    rows.push(...page);
    cursor = nextCursor;
  }
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
    const batchRows = await readTransactionBatch(
      supabase,
      orderIds.slice(offset, offset + batchSize)
    );
    if (batchRows === null) {
      // A later page could contain a conflicting reference: discard this whole
      // incomplete batch while preserving independently completed batches.
      lookupFailed = true;
      continue;
    }
    rows.push(...batchRows);
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
