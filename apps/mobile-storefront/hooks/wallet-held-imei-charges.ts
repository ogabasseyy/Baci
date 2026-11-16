import {
  HELD_STATUSES,
  IMEI_CHARGE_SOURCE,
  REFUNDING_STATUS,
  STATUS_READ_TIMEOUT_MS,
  WALLET_RETURN_MARGIN_MS,
} from './wallet-held-imei-charge-constants';
import { WALLET_LOAD_TIMEOUT_MS } from './wallet-load-deadline';
import type { Transaction } from './wallet-query';

/** Reads `id, status` of the customer's own IMEI checks (RLS-scoped). */
export type ReadLookupStatuses = (
  ids: string[]
) => PromiseLike<{ data: unknown; error: unknown } | null | undefined>;

function sourceIdOf(row: unknown) {
  if (
    typeof row !== 'object' ||
    row === null ||
    !('id' in row) ||
    !('source_type' in row) ||
    !('source_id' in row)
  )
    return null;
  const { id, source_type, source_id } = row;
  return source_type === IMEI_CHARGE_SOURCE &&
    typeof id === 'string' &&
    typeof source_id === 'string'
    ? { id, sourceId: source_id }
    : null;
}

function lookupStatusOf(lookup: unknown) {
  if (
    typeof lookup !== 'object' ||
    lookup === null ||
    !('id' in lookup) ||
    !('status' in lookup)
  )
    return null;
  const { id, status } = lookup;
  return typeof id === 'string' && typeof status === 'string'
    ? { id, status }
    : null;
}

/**
 * Marks IMEI check charges whose check is still running as pending (walk
 * 2026-11-15, M3), so a held charge never reads as a finished purchase.
 * Best effort: when the checks can't be read, rows show as before.
 */
export async function markHeldImeiCharges(
  readStatuses: ReadLookupStatuses,
  rawRows: readonly unknown[],
  transactions: Transaction[],
  /** When the wallet load started: the read never outlasts its deadline. */
  loadStartedAt: number = Date.now()
): Promise<Transaction[]> {
  const charges = rawRows.map(sourceIdOf).filter((row) => row !== null);
  if (charges.length === 0) return transactions;
  const budget = Math.min(
    STATUS_READ_TIMEOUT_MS,
    loadStartedAt +
      WALLET_LOAD_TIMEOUT_MS -
      WALLET_RETURN_MARGIN_MS -
      Date.now()
  );
  if (budget <= 0) return transactions;
  const ids = [...new Set(charges.map((charge) => charge.sourceId))];
  let result: Awaited<ReturnType<ReadLookupStatuses>>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Best effort: a stalled read must never hold up the wallet load.
    result = await Promise.race([
      readStatuses(ids),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), budget);
      }),
    ]);
  } catch {
    return transactions;
  } finally {
    clearTimeout(timer);
  }
  if (!result || result.error || !Array.isArray(result.data))
    return transactions;
  const stateOf = new Map<string, 'pending' | 'refunding'>();
  for (const lookup of result.data) {
    const row = lookupStatusOf(lookup);
    if (!row) continue;
    if (HELD_STATUSES.has(row.status)) stateOf.set(row.id, 'pending');
    else if (row.status === REFUNDING_STATUS) stateOf.set(row.id, 'refunding');
  }
  const stateOfTransaction = new Map(
    charges.flatMap((charge) => {
      const state = stateOf.get(charge.sourceId);
      return state ? [[charge.id, state] as const] : [];
    })
  );
  return transactions.map((transaction) => {
    const state = stateOfTransaction.get(transaction.id);
    if (state === 'pending') return { ...transaction, pending: true };
    if (state === 'refunding') return { ...transaction, refunding: true };
    return transaction;
  });
}
