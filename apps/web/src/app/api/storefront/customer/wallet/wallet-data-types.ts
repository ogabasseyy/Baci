/**
 * Row and response types for `GET /api/storefront/customer/wallet`. Route-private
 * (colocated), shared by the data helpers and fetchers.
 */

export interface WalletFundingAccountRow {
  account_name: string;
  account_number: string;
  bank_name: string;
  provider: string;
}

export interface CustomerSavingsEarnings {
  earningsAvailable: boolean;
  earningsBalance: number | null;
}

export interface CustomerWalletTransactionRow {
  amount: number | string;
  balance_after: number | string | null;
  created_at: string | null;
  description: string | null;
  id: string;
  source_type: string | null;
  type: string;
}

/**
 * Result of `fetchCustomerWallet`.
 *
 * Fails LOUD on any real error rather than collapsing to an empty result:
 * - PGRST116 ("no row returned") is the truth — the customer has no wallet yet —
 *   and maps to `no-wallet`, a legitimately empty response.
 * - Any OTHER wallet error, or a transactions error, maps to `error`. An empty
 *   `transactions` list served as success is indistinguishable from "this wallet
 *   has no history", which would hand the funding-check loop an empty baseline
 *   and let an OLD top-up settle as the customer's new transfer — a false "money
 *   received". The route turns `error` into a 500 so the client stays
 *   fail-closed. `source_type` is selected because `type` is 'credit' for
 *   cashback/refunds too; only `source_type = 'wallet_topup'` proves an inbound
 *   transfer landed.
 */
export type CustomerWalletFetch =
  | { kind: 'error' }
  | { kind: 'no-wallet' }
  | {
      availableBalance: number;
      kind: 'ok';
      totalEarned: number;
      totalRedeemed: number;
      transactions: CustomerWalletTransactionRow[];
    };
