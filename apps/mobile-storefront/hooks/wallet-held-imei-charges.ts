import type { Transaction } from './wallet-query';

/** IMEI check states where the charge is held: the check has not finished. */
export const HELD_STATUSES = new Set([
  'pending',
  'provider_submitting',
  'pending_provider',
  'submission_unknown',
]);

/** The check failed and its charge is on its way back to the wallet. */
export const REFUNDING_STATUS = 'refund_pending';

/** Finished states: the row reads as a plain charge (or its refund row). */
export const FINISHED_STATUSES = new Set([
  'completed',
  'wallet_rejected',
  'failed_error',
  'refunded_error',
  'refunded_not_found',
]);

const IMEI_CHARGE_SOURCE = 'imei_wallet_payment';

/** Reads `id, status` of the customer's own IMEI checks (RLS-scoped). */
export type ReadLookupStatuses = (
  ids: string[]
) => PromiseLike<{ data: unknown; error: unknown } | null | undefined>;

function sourceIdOf(row: unknown) {
  if (!row || typeof row !== 'object') return null;
  const { id, source_type, source_id } = row as Record<string, unknown>;
  return source_type === IMEI_CHARGE_SOURCE &&
    typeof id === 'string' &&
    typeof source_id === 'string'
    ? { id, sourceId: source_id }
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
  transactions: Transaction[]
): Promise<Transaction[]> {
  const charges = rawRows.map(sourceIdOf).filter((row) => row !== null);
  if (charges.length === 0) return transactions;
  const ids = [...new Set(charges.map((charge) => charge.sourceId))];
  let result: Awaited<ReturnType<ReadLookupStatuses>>;
  try {
    result = await readStatuses(ids);
  } catch {
    return transactions;
  }
  if (!result || result.error || !Array.isArray(result.data))
    return transactions;
  const stateOf = new Map<string, 'pending' | 'refunding'>();
  for (const lookup of result.data as unknown[]) {
    const { id, status } = (lookup ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || typeof status !== 'string') continue;
    if (HELD_STATUSES.has(status)) stateOf.set(id, 'pending');
    else if (status === REFUNDING_STATUS) stateOf.set(id, 'refunding');
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
