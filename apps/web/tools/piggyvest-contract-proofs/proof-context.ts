import type { RunMode } from './constants';
import type { ProviderApi, QaIdentity } from './provider-ops';
import type { Redactor } from './redactor';

export interface WalletView {
  id: string;
  role: 'main' | 'goal' | 'other';
  createdAt: string | null;
  name: string | null;
}

/** Facts measured around one transfer, consumed by the fee proof. */
export interface TransferObservation {
  kind: 'wallet' | 'bank';
  amountKobo: number;
  terminal: 'success' | 'failed' | 'timeout' | 'not_run';
  sourceDeltaKobo: number | null;
  destinationDeltaKobo: number | null;
  feeFromRecordKobo: number | null;
}

export interface DepositObservation {
  grossKobo: number;
  creditedKobo: number | null;
  feeFromRecordKobo: number | null;
}

export interface ScenarioState {
  customerId: string | null;
  /** Wallet returned by the first create call: ground truth for "default". */
  createdWalletId: string | null;
  /** `new_customer` from the scenario's own create call, if it ran. */
  createdNewCustomer: boolean | null;
  mainWalletId: string | null;
  mainWalletBasis: 'create_response' | 'earliest_created_heuristic' | 'none';
  goalWalletId: string | null;
  wallets: WalletView[];
  /** Wallets proven to belong to the allowlisted QA customer. */
  authorized: Set<string>;
  notes: string[];
  walletTransfer: TransferObservation | null;
  bankTransfer: TransferObservation | null;
  deposit: DepositObservation | null;
}

export function emptyScenarioState(): ScenarioState {
  return {
    customerId: null,
    createdWalletId: null,
    createdNewCustomer: null,
    mainWalletId: null,
    mainWalletBasis: 'none',
    goalWalletId: null,
    wallets: [],
    authorized: new Set(),
    notes: [],
    walletTransfer: null,
    bankTransfer: null,
    deposit: null,
  };
}

export interface ProofContext {
  mode: RunMode;
  api: ProviderApi;
  redactor: Redactor;
  qa: QaIdentity;
  state: ScenarioState;
  sleep: (ms: number) => Promise<void>;
  pollIntervalMs: number;
  maxPolls: number;
  /** Mutation attempt number (opened by --new-attempt); keeps re-test names unique. */
  attempt: number;
  /** Operator-supplied sandbox destination for the bank-outflow step. */
  bank: { code: string; account: string } | null;
  /** Ogabassey business sandbox wallet (interest payout target, proof 7). */
  businessWalletId: string | null;
}
