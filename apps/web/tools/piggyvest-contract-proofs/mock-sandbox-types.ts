import { createHash } from 'node:crypto';

/**
 * In-memory stand-in for the PiggyVest sandbox, modelled on the public docs
 * samples (response shapes, status vocabularies, 202 "processing"). It is
 * NOT evidence: every behaviour that the live run has to confirm is a knob
 * in MockOptions, so proof logic is tested against both outcomes.
 */

import type { PagingMode } from './mock-paging';

export interface MockOptions {
  repostReturnsOriginalDefault: boolean;
  echoThirdPartyIdentifierOnCreate: boolean;
  customerListContainer: 'paginatedPayload' | 'edges' | 'array';
  customerListEchoesIdentifier: boolean;
  walletListIncludesCreatedAt: boolean;
  walletListIncludesCustomerId: boolean;
  tsqShape: 'docs' | 'rich';
  tsqNotFoundPolls: number;
  tsqPendingPolls: number;
  /** The transfer's money and counters move at the FIRST status check, though TSQ keeps saying pending. */
  tsqSettleEarly: boolean;
  /** Pending polls for BANK outflows; null = tsqPendingPolls. */
  tsqPendingPollsBank: number | null;
  depositFeeKobo: number;
  depositFeeBorneByWallet: boolean;
  transferFeeKobo: number;
  bankFeeKobo: number;
  w2wIncrementsCounter: boolean;
  bankIncrementsCounter: boolean;
  counterScope: 'wallet' | 'customer';
  fundingSettles: boolean;
  failNetworkOnce: string[];
  /** GET paths containing any of these answer HTTP 503 until the list is cleared. */
  serverErrorPaths: string[];
  /** When set, a 503 keeps this object as the envelope `data` (a failed read that still looks valid). */
  serverErrorData: Record<string, unknown> | null;
  /** Wallet reads keep showing the pre-settlement balance for this many reads. */
  balanceLagReads: number;
  /** New transactions are missing from list reads for this many list reads. */
  listLagReads: number;
  /** A new wallet's readback omits interest settings for this many reads. */
  settingsLagReads: number;
  /** A new wallet's readback omits ONLY the payout destination field for this many reads. */
  payoutFieldLagReads: number;
  accruedEdgeCount: number;
  /** The interest rate goal (non-default) wallets show; the default wallet always shows 0. */
  goalInterestRate: number;
  /** How cursor paging behaves on the accrual and transaction lists. */
  pagingMode: PagingMode;
  /** GET paths that fail only for a stretch: `skip` succeed, then `fail` answer 503, then recover; with `every`, every Nth matching request fails instead. */
  flakyPaths: { needle: string; skip: number; fail: number; every?: number }[];
  /** Wallet reads that must pass before a settled outflow shows in withdrawal_count. */
  counterLagReads: number;
  /** Same, for wallets other than the customer's default one; null = counterLagReads. */
  counterLagReadsGoal: number | null;
  customerPayoutWallet: 'accepted' | 'rejected';
  subAccountAcceptsPayout: boolean;
  subWalletInheritsPayout: boolean;
  payoutReadback: 'fields' | 'none' | 'accrual_only';
  /** Sub-wallet readbacks drop the payout field while the main wallet keeps it. */
  goalReadbackOmitsPayout: boolean;
}

export const DEFAULT_MOCK_OPTIONS: MockOptions = {
  repostReturnsOriginalDefault: true,
  echoThirdPartyIdentifierOnCreate: false,
  customerListContainer: 'paginatedPayload',
  customerListEchoesIdentifier: true,
  walletListIncludesCreatedAt: true,
  walletListIncludesCustomerId: false,
  tsqShape: 'docs',
  tsqNotFoundPolls: 0,
  tsqPendingPolls: 1,
  tsqSettleEarly: false,
  tsqPendingPollsBank: null,
  depositFeeKobo: 5_000,
  depositFeeBorneByWallet: true,
  transferFeeKobo: 0,
  bankFeeKobo: 5_000,
  w2wIncrementsCounter: false,
  bankIncrementsCounter: true,
  counterScope: 'wallet',
  fundingSettles: true,
  failNetworkOnce: [],
  serverErrorPaths: [],
  serverErrorData: null,
  balanceLagReads: 0,
  listLagReads: 0,
  settingsLagReads: 0,
  payoutFieldLagReads: 0,
  accruedEdgeCount: 0,
  goalInterestRate: 0,
  pagingMode: 'advance',
  flakyPaths: [],
  counterLagReads: 0,
  counterLagReadsGoal: null,
  customerPayoutWallet: 'accepted',
  subAccountAcceptsPayout: true,
  subWalletInheritsPayout: false,
  payoutReadback: 'fields',
  goalReadbackOmitsPayout: false,
};

export interface MockReply {
  status: number;
  body: unknown;
}
export type Body = Record<string, unknown>;
export const ok = (data: unknown, message = 'ok', status = 200): MockReply => ({
  status,
  body: { status: true, message, data },
});
export const fail = (message: string, status = 400): MockReply => ({
  status,
  body: { status: false, message },
});

export interface Wallet {
  id: string;
  customerId: string;
  name: string;
  createdAt: string;
  balance: number;
  withdrawalCount: number;
  lagged: { count: number; readsLeft: number } | null;
  payoutWalletId: string | null;
  interestEnabled: boolean;
  staleBalance: { value: number; readsLeft: number } | null;
  settingsHiddenReads: number;
  payoutHiddenReads: number;
  account: string;
}
export interface Customer {
  id: string;
  bvn: string;
  email: string;
  phone: string;
  name: string;
  tpi: string | null;
  defaultWalletId: string;
  payoutWalletId: string | null;
}
export interface Txn {
  id: string;
  creditId: string;
  reference: string | null;
  category: string;
  source: string | null;
  destination: string | null;
  amount: number;
  fee: number;
  status: 'pending' | 'success';
  polls: number;
  hiddenReads: number;
  createdAt: string;
}

export const ulid = (salt: string, n: number) =>
  `01M2T${createHash('sha1').update(`${salt}${n}`).digest('hex').slice(0, 21).toUpperCase()}`;
