import type { Transaction } from './wallet-query';

/** IMEI check states where the charge is held: the check has not finished. */
const HELD_STATUSES = new Set([
  'pending',
  'provider_submitting',
  'pending_provider',
  'submission_unknown',
  'refund_pending',
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
  const held = new Set(
    result.data.flatMap((lookup: unknown) => {
      const { id, status } = (lookup ?? {}) as Record<string, unknown>;
      return typeof id === 'string' &&
        typeof status === 'string' &&
        HELD_STATUSES.has(status)
        ? [id]
        : [];
    })
  );
  const heldTransactions = new Set(
    charges
      .filter((charge) => held.has(charge.sourceId))
      .map((charge) => charge.id)
  );
  return transactions.map((transaction) =>
    heldTransactions.has(transaction.id)
      ? { ...transaction, pending: true }
      : transaction
  );
}
