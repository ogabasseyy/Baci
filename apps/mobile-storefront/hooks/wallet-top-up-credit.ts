import type { WalletLedgerPosition } from '@/lib/wallet-funding-session';

/**
 * Ledger provenance written by `credit_customer_wallet(p_source_type => …)`
 * for every wallet funding credit — card, USDT, and (the flow this powers)
 * Paystack dedicated-virtual-account bank transfers. Cashback lands as
 * `vtu_transaction`, reversals as `order_reversal`, so this value — not the
 * `credit` row type and not a balance delta — is what identifies a top-up.
 */
export const WALLET_TOP_UP_SOURCE_TYPE = 'wallet_topup';

/** Structural subset of a wallet transaction the credit watch needs. */
export interface WalletTopUpCandidate {
  amount: number;
  created_at: string | null;
  id: string;
  source_type?: string | null;
  type: string;
}

/**
 * A ledger row that passed validation. `createdAt` is non-nullable by
 * construction: a row whose `created_at` cannot be parsed never becomes a
 * `WalletTopUpCredit`, so every comparison downstream is between two SERVER
 * timestamps we actually trust. It is a `WalletLedgerPosition` (+ the amount to
 * announce), so a credit can be persisted as the funding session's anchor.
 */
export interface WalletTopUpCredit extends WalletLedgerPosition {
  amount: number;
}

function isTopUpCredit(transaction: WalletTopUpCandidate): boolean {
  return (
    transaction.type === 'credit' &&
    transaction.source_type === WALLET_TOP_UP_SOURCE_TYPE &&
    Number.isFinite(transaction.amount)
  );
}

/**
 * Fails closed: an unparseable `created_at` yields `null`, and the caller drops
 * the row entirely. Silently keeping such a row would let it be compared by id
 * alone and reported as a fresh credit that may never have landed.
 */
function toCreatedAt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Newest wallet top-up credit in the transaction list, or `null` when the list
 * is unavailable (still loading) or holds no top-up with a usable timestamp.
 * Rows whose `created_at` cannot be parsed are skipped rather than kept — an
 * unusable timestamp cannot prove a credit landed, and keeping one would also
 * mask a genuinely newer row behind it. The list is not trusted to be sorted;
 * ties keep the first match, which is the server's `created_at desc` order.
 *
 * This is BOTH the head the watch compares against and the value it persists as
 * the funding session's anchor — there is no timestamp-cutoff variant, because a
 * device clock must never select which ledger rows count as "already there".
 */
export function findLatestWalletTopUpCredit(
  transactions: readonly WalletTopUpCandidate[] | undefined
): WalletTopUpCredit | null {
  if (!transactions) {
    return null;
  }

  let latest: WalletTopUpCredit | null = null;
  for (const transaction of transactions) {
    if (!isTopUpCredit(transaction)) {
      continue;
    }
    const createdAt = toCreatedAt(transaction.created_at);
    if (createdAt === null) {
      continue;
    }
    if (latest === null || createdAt > latest.createdAt) {
      latest = {
        amount: transaction.amount,
        createdAt,
        id: transaction.id,
      };
    }
  }

  return latest;
}

/**
 * True when `latest` is a top-up the customer has not already been shown — i.e.
 * a different ledger row than the pre-transfer baseline AND strictly newer than
 * it. A `null` baseline means "no top-up existed when the panel opened", so any
 * top-up is new.
 *
 * Newness is decided on validated timestamps only. A differing id is never
 * treated as proof of chronological newness: ids are opaque, so a same-instant
 * row with a different id must NOT be claimed as a fresh credit. Missing a
 * same-millisecond credit only costs a timeout ("we couldn't confirm it yet"),
 * while falsely claiming a credit tells a customer money arrived when it did
 * not — the one outcome this feature must never produce.
 */
export function isNewWalletTopUpCredit(
  latest: WalletTopUpCredit,
  baseline: WalletLedgerPosition | null
): boolean {
  if (baseline === null) {
    return true;
  }
  if (latest.id === baseline.id) {
    return false;
  }
  return latest.createdAt > baseline.createdAt;
}
