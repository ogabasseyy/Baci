import { DEFAULT_MOCK_OPTIONS, type MockOptions } from './mock-sandbox';
import type { Scalar } from './types';

/**
 * What the mock sandbox TRULY does, per finding and per published value, as a
 * function of its behaviour options. The oracle compares the harness's answers
 * against this; turbulence options never change it.
 *
 *  - 'yes' / 'no'   the true answer
 *  - 'unobservable' this scenario gives no way to know: any answer other than
 *                   `unknown` is an overclaim
 *  - 'any'          not checked against the sandbox (depends on an external schema)
 */
export type Truth = 'yes' | 'no' | 'unobservable' | 'any';

export interface TruthContext {
  o: MockOptions;
  /** Rows (debit + credit) the main QA wallet really has when proof 5 runs. */
  mainRows: number;
  /** Wallets the QA customer really has when proof 1 runs (the re-POST can only pick another one if there is one). */
  qaWallets: number;
}

const bool = (value: boolean): Truth => (value ? 'yes' : 'no');

/** The re-POST hands back the default wallet, unless it is configured to pick another AND one exists. */
const repostReturnsDefault = (c: TruthContext): boolean =>
  c.o.repostReturnsOriginalDefault || c.qaWallets < 2;
const YES = (): Truth => 'yes';
const NO = (): Truth => 'no';

/** The deposit proof needs the sandbox funding to credit; otherwise nothing can be observed. */
const ifFunded = (c: TruthContext): Truth =>
  c.o.fundingSettles ? 'yes' : 'unobservable';
/** Findings about the P7 customer exist only if its creation was accepted. */
const ifP7Created = (c: TruthContext, truth: Truth): Truth =>
  c.o.customerPayoutWallet === 'accepted' ? truth : 'unobservable';

export const FINDING_TRUTH: Record<string, (c: TruthContext) => Truth> = {
  // proof 1
  lookup_by_identifier_finds_customer: YES,
  list_echoes_identifier: (c) => bool(c.o.customerListEchoesIdentifier),
  repost_returns_same_wallet_id: (c) => bool(repostReturnsDefault(c)),
  repost_returns_same_customer_id: YES,
  repost_reports_existing_customer: YES,
  create_response_echoes_identifier: (c) =>
    bool(c.o.echoThirdPartyIdentifierOnCreate),
  default_wallet_is_earliest_created: YES,
  explicit_default_flag_in_wallet_list: NO,
  wallet_retrieve_exposes_customer_binding: YES,
  // proof 2
  unknown_reference_is_404: YES,
  tsq_shows_amount: YES,
  tsq_amount_matches_sent: YES,
  tsq_shows_currency: (c) => bool(c.o.tsqShape === 'rich'),
  tsq_shows_fee: (c) => bool(c.o.tsqShape === 'rich'),
  tsq_shows_status: YES,
  tsq_names_source_wallet: (c) => bool(c.o.tsqShape === 'rich'),
  tsq_names_destination_wallet: (c) => bool(c.o.tsqShape === 'rich'),
  existing_typed_tsq_schema_accepts_response: () => 'any',
  tsq_found_with_source_wallet_filter: YES,
  tsq_found_with_destination_wallet_filter: YES,
  single_transaction_names_both_wallets: YES,
  single_transaction_shows_fee: YES,
  // proof 3
  goal_wallet_has_own_virtual_account: YES,
  goal_account_differs_from_main: YES,
  webhook_names_goal_wallet: () => 'unobservable',
  credited_to_goal_wallet: (c) => bool(c.o.fundingSettles),
  main_wallet_unchanged: YES,
  transaction_list_names_goal_wallet: ifFunded,
  main_wallet_list_excludes_deposit_row: ifFunded,
  single_transaction_names_destination_wallet: ifFunded,
  // proof 4
  w2w_changes_counter: (c) => bool(c.o.w2wIncrementsCounter),
  bank_outflow_changes_counter: (c) => bool(c.o.bankIncrementsCounter),
  // proof 5
  // The mock's accrual reply copies the live shape (2026-10-31), so the
  // existing typed schema must accept it whenever the read succeeds.
  existing_accrual_schema_accepts_response: YES,
  accrual_records_observed: (c) => bool(c.o.accruedEdgeCount > 0),
  accrual_edge_shape_observed: (c) => bool(c.o.accruedEdgeCount > 0),
  accrual_cursor_advances: (c) =>
    c.o.accruedEdgeCount < 2
      ? 'unobservable'
      : bool(c.o.pagingMode === 'advance'),
  transaction_list_cursor_advances: (c) =>
    c.mainRows < 2 ? 'unobservable' : bool(c.o.pagingMode === 'advance'),
  transaction_list_has_interest_rows: NO,
  // proof 6
  deposit_fee_field_present: ifFunded,
  transfer_fee_field_present: YES,
  transfer_source_debited_exactly_amount: YES,
  transfer_destination_credited_exactly_amount: YES,
  // proof 7
  customer_create_with_payout_accepted: (c) =>
    bool(c.o.customerPayoutWallet === 'accepted'),
  customer_created_fresh: (c) => ifP7Created(c, 'yes'),
  main_wallet_readback_exposes_interest_fields: (c) =>
    ifP7Created(c, bool(c.o.payoutReadback !== 'none')),
  main_wallet_readback_names_payout_destination: (c) =>
    ifP7Created(c, bool(c.o.payoutReadback === 'fields')),
  main_wallet_accrual_flag_readable: (c) =>
    ifP7Created(c, bool(c.o.payoutReadback !== 'none')),
  goal_without_payout_created: YES,
  goal_without_payout_inherits_business_payout: (c) =>
    ifP7Created(c, bool(c.o.subWalletInheritsPayout)),
  goal_explicit_payout_accepted: (c) => bool(c.o.subAccountAcceptsPayout),
  goal_explicit_readback_names_payout_destination: (c) =>
    c.o.subAccountAcceptsPayout
      ? bool(c.o.payoutReadback === 'fields' && !c.o.goalReadbackOmitsPayout)
      : 'unobservable',
};

/** Published values that are measurements: when non-null they must equal the truth. */
export const VALUE_TRUTH: Record<
  string,
  (c: TruthContext) => readonly (Scalar | null)[]
> = {
  counter_scope: (c) =>
    c.o.bankIncrementsCounter
      ? [
          c.o.counterScope === 'customer' ? 'per_customer' : 'per_wallet',
          'unknown',
        ]
      : ['unknown'],
  interest_rate_nonzero_on_any_wallet: (c) => [c.o.goalInterestRate > 0],
  deposit_credit_relation: (c) => [
    c.o.depositFeeBorneByWallet && c.o.depositFeeKobo > 0
      ? 'net_of_fee'
      : 'gross',
    'unknown',
  ],
  deposit_fee_kobo: (c) => [c.o.depositFeeKobo],
  transfer_fee_kobo: (c) => [c.o.transferFeeKobo],
  adoption_rule: (c) => [
    repostReturnsDefault(c) ? 'supported' : 'not_supported',
    'unconfirmed',
  ],
  interest_routing_verdict: (c) =>
    c.o.customerPayoutWallet === 'rejected'
      ? ['create_time_routing_rejected', 'unconfirmed']
      : c.o.payoutReadback === 'fields'
        ? ['create_time_routing_verified', 'unconfirmed']
        : ['create_time_routing_accepted_but_unverifiable', 'unconfirmed'],
};

export const resolvedOptions = (mock: Partial<MockOptions>): MockOptions => ({
  ...DEFAULT_MOCK_OPTIONS,
  ...mock,
});
