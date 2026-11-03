import type { RunMode } from './constants';
import type { QaIdentity } from './provider-ops';
import type { ProofApi } from './provider-ops-proofs';
import type { Redactor } from './redactor';
import type { TransportFaults } from './transport-faults';

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
  /** null = no record was read, so absence of a fee field is not established. */
  feeFieldPresent: boolean | null;
  /** Our own reference for the transfer (proof 2's duplicate-reference step re-sends it). */
  reference?: string;
  /** The send itself was journaled 'accepted' (only such a reference may be re-sent). */
  sendAccepted?: boolean;
}

export interface DepositObservation {
  grossKobo: number;
  creditedKobo: number | null;
  feeFromRecordKobo: number | null;
  /** null = no record was read, so absence of a fee field is not established. */
  feeFieldPresent: boolean | null;
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
  /** The business sandbox wallet, once admitted as the house wallet (house-wallet.ts). */
  houseWalletId: string | null;
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
    houseWalletId: null,
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
  api: ProofApi;
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
  /** Lets a proof lose one response after the request left (S8 timeout step). */
  faults?: TransportFaults;
}
