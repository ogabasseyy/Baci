const PAYSTACK_DVA_ACCOUNT_NUMBER = /^\d{6,20}$/;
const COMPLETED_TRANSACTION_STATUSES = new Set(['completed', 'success']);

interface PaystackDvaTransactionLike {
  created_at?: string | null;
  gateway?: string | null;
  metadata?: unknown;
  status?: string | null;
  transaction_type?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Return the DVA recorded on the latest successful Paystack payment.
 *
 * A customer can have several historical aliases for one order. The
 * transaction metadata is the authoritative receiver for a payment, so
 * callers rendering a paid document can use it to select the matching alias
 * instead of relying on alias recency.
 */
export function getPaystackDvaAccountNumberFromTransactions(
  transactions: readonly PaystackDvaTransactionLike[] | null | undefined
): string | null {
  let winner: {
    accountNumber: string;
    createdAtMs: number;
    index: number;
  } | null = null;

  for (const [index, transaction] of (transactions ?? []).entries()) {
    const gateway = transaction.gateway?.trim().toLowerCase();
    if (gateway && gateway !== 'paystack') continue;

    const transactionType = transaction.transaction_type?.trim().toLowerCase();
    if (transactionType && transactionType !== 'payment') continue;

    const status = transaction.status?.trim().toLowerCase();
    if (status && !COMPLETED_TRANSACTION_STATUSES.has(status)) continue;

    const metadata = asRecord(transaction.metadata);
    const accountNumber =
      typeof metadata?.dva_account_number === 'string'
        ? metadata.dva_account_number.trim()
        : '';
    if (!PAYSTACK_DVA_ACCOUNT_NUMBER.test(accountNumber)) continue;

    const parsedCreatedAt = transaction.created_at
      ? Date.parse(transaction.created_at)
      : Number.NaN;
    const createdAtMs = Number.isFinite(parsedCreatedAt)
      ? parsedCreatedAt
      : Number.NEGATIVE_INFINITY;
    if (
      winner &&
      (createdAtMs < winner.createdAtMs ||
        (createdAtMs === winner.createdAtMs && index < winner.index))
    ) {
      continue;
    }

    winner = { accountNumber, createdAtMs, index };
  }

  return winner?.accountNumber ?? null;
}
