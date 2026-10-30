import { createHash } from 'node:crypto';

/**
 * In-memory stand-in for the PiggyVest sandbox, modelled on the public docs
 * samples (response shapes, status vocabularies, 202 "processing"). It is
 * NOT evidence: every behaviour that the live run has to confirm is a knob
 * in MockOptions, so proof logic is tested against both outcomes.
 */

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
  depositFeeKobo: number;
  depositFeeBorneByWallet: boolean;
  transferFeeKobo: number;
  bankFeeKobo: number;
  w2wIncrementsCounter: boolean;
  bankIncrementsCounter: boolean;
  counterScope: 'wallet' | 'customer';
  fundingSettles: boolean;
  failNetworkOnce: string[];
  accruedEdgeCount: number;
  /** Wallet reads that must pass before a settled outflow shows in withdrawal_count. */
  counterLagReads: number;
  customerPayoutWallet: 'accepted' | 'rejected';
  subAccountAcceptsPayout: boolean;
  subWalletInheritsPayout: boolean;
  payoutReadback: 'fields' | 'none';
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
  depositFeeKobo: 5_000,
  depositFeeBorneByWallet: true,
  transferFeeKobo: 0,
  bankFeeKobo: 5_000,
  w2wIncrementsCounter: false,
  bankIncrementsCounter: true,
  counterScope: 'wallet',
  fundingSettles: true,
  failNetworkOnce: [],
  accruedEdgeCount: 0,
  counterLagReads: 0,
  customerPayoutWallet: 'accepted',
  subAccountAcceptsPayout: true,
  subWalletInheritsPayout: false,
  payoutReadback: 'fields',
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
  createdAt: string;
}

export const ulid = (salt: string, n: number) =>
  `01M2T${createHash('sha1').update(`${salt}${n}`).digest('hex').slice(0, 21).toUpperCase()}`;
