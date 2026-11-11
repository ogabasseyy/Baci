import 'server-only';
import { piggyvestTransactionListSchemas } from '@/schemas/piggyvest-transaction-list';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';

/**
 * Reads one wallet's credits at PiggyVest since a time, for the credit-gap
 * check. Read-only: GET /api/v1/transaction?wallet_id=… only.
 *
 * The row `id` is PiggyVest's canonical transaction id: the same id
 * GET /api/v1/transaction/:id answers for the webhook envelope's
 * `pvb_reference` (savings-exit-evidence.ts and
 * prefunded-card-provider-evidence-normalize.ts require `id ===
 * pvb_reference`). So a credit's row id is its PVB credit id (`PVB01…`).
 *
 * The list is read newest first (as the contract proofs read it). That order
 * is checked, never assumed: a row newer than one before it makes the read
 * `incomplete`, so a list in another order can never end the read early and
 * hide a credit. Reading stops once a page reaches rows older than `since`,
 * when there are no more pages, or after MAX_PAGES (then `incomplete`). The
 * shared deadline is checked before every page, so a wallet needing many
 * pages cannot run the daily job past its budget.
 */
export const CREDIT_LIST_PAGE_SIZE = 100;
export const CREDIT_LIST_MAX_PAGES = 10;

export interface ProviderCredit {
  id: string;
  category: string;
  status: 'pending' | 'successful' | 'failed' | 'partial';
  amountKobo: number;
  createdAt: string;
}

export type ProviderCreditListing =
  | { outcome: 'complete'; credits: ProviderCredit[] }
  | {
      outcome: 'incomplete';
      reason: 'page_limit' | 'order_unexpected' | 'deadline';
    }
  | { outcome: 'unreadable' };

export type ListWalletPage = (input: {
  walletId: string;
  cursor: string | null;
}) => Promise<unknown>;

export async function listWalletCreditsSince(input: {
  walletId: string;
  sinceMs: number;
  listPage: ListWalletPage;
  /** True once the shared read budget is spent: no further page starts. */
  expired?: () => boolean;
}): Promise<ProviderCreditListing> {
  const credits: ProviderCredit[] = [];
  let cursor: string | null = null;
  let previousMs = Number.POSITIVE_INFINITY;
  for (let page = 0; page < CREDIT_LIST_MAX_PAGES; page += 1) {
    if (input.expired?.()) return { outcome: 'incomplete', reason: 'deadline' };
    let response: unknown;
    try {
      response = await input.listPage({ walletId: input.walletId, cursor });
    } catch {
      return { outcome: 'unreadable' };
    }
    const parsed = piggyvestTransactionListSchemas.response.safeParse(response);
    if (!parsed.success) return { outcome: 'unreadable' };
    const { edges, pageInfo } = parsed.data.data;
    if (
      edges.length > CREDIT_LIST_PAGE_SIZE ||
      edges.some((row) => row.wallet_id !== input.walletId) ||
      (pageInfo.hasNextPage && pageInfo.endCursor === cursor)
    )
      return { outcome: 'unreadable' };
    let reachedOlder = false;
    for (const row of edges) {
      const createdMs = Date.parse(row.created_at);
      if (Number.isNaN(createdMs)) return { outcome: 'unreadable' };
      if (createdMs > previousMs)
        return { outcome: 'incomplete', reason: 'order_unexpected' };
      previousMs = createdMs;
      if (createdMs < input.sinceMs) {
        reachedOlder = true;
        continue;
      }
      if (row.type === 'credit')
        credits.push({
          id: row.id,
          category: row.category,
          status: row.status,
          amountKobo: row.amount,
          createdAt: row.created_at,
        });
    }
    if (reachedOlder || !pageInfo.hasNextPage)
      return { outcome: 'complete', credits };
    cursor = pageInfo.endCursor;
  }
  return { outcome: 'incomplete', reason: 'page_limit' };
}

/** The real page reader: PiggyVest's transaction list for one wallet. */
export function createWalletPageReader(transport: {
  environment: 'staging' | 'production';
  token: string;
  fetchImplementation: typeof fetch;
}): ListWalletPage {
  const origin = getPrimaryWalletProviderOrigin(transport.environment);
  return ({ walletId, cursor }) => {
    const parameters = new URLSearchParams({
      wallet_id: walletId,
      limit: String(CREDIT_LIST_PAGE_SIZE),
      collapse_batch: '0',
    });
    if (cursor !== null) parameters.set('cursor', cursor);
    return requestPrefundedCardProviderJson({
      url: `${origin}/api/v1/transaction?${parameters.toString()}`,
      token: transport.token,
      timeoutMs: 10_000,
      maxResponseBytes: 1_048_576,
      fetchImplementation: transport.fetchImplementation,
      init: { method: 'GET' },
    });
  };
}
