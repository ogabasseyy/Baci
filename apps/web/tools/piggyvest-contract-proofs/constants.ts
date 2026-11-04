import { PIGGYVEST_STAGING_API_ORIGIN } from '@/schemas/piggyvest-staging-configuration';

/**
 * Shared constants for the PiggyVest sandbox contract-proof harness.
 * Nothing here is a secret. See cli.ts for how to run each mode.
 */

export const RUN_MODES = [
  'dry-run',
  'live-readonly',
  'live-sandbox-mutations',
] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const PROOF_IDS = [
  'p1',
  'p2',
  'p3',
  'p4',
  'p5',
  'p6',
  'p7',
  'p8',
  'p9',
  'p10',
] as const;

/**
 * Proofs that create their own QA customer and need nothing from the shared
 * scenario: run alone (--proof), they skip its customer, goal, funding and
 * transfers entirely.
 */
export const STANDALONE_PROOFS: readonly (typeof PROOF_IDS)[number][] = ['p7'];

/**
 * Proofs that only measure what other proofs in the same run did (proof 6
 * reads the transfer and the deposit that proofs 2 and 3 make; proofs 8 and 9
 * read the transfers and the goal deposit those proofs leave), so --proof
 * refuses them: alone they would spend scenario mutations and measure nothing.
 */
export const FULL_RUN_ONLY_PROOFS: readonly (typeof PROOF_IDS)[number][] = [
  'p6',
  'p8',
  'p9',
];

/** The only modes that may send a state-changing request. Everything else fails closed. */
export const MUTATION_CAPABLE_MODES: readonly RunMode[] = [
  'dry-run',
  'live-sandbox-mutations',
];

/** The only origin the harness will ever talk to. */
export const SANDBOX_ORIGIN = PIGGYVEST_STAGING_API_ORIGIN;
export const SANDBOX_HOST = 'staging.piggyvest.business';

/**
 * The account used for the screen recording. The harness must never touch
 * it, in any mode. Matching is done on a normalised form (see
 * safety-guards.ts) so case, plus-addressing and URL-encoding cannot hide it.
 */
export const RECORDING_ACCOUNT_EMAIL = 'baci-recording-20261013@example.com';
export const RECORDING_ACCOUNT_NORMALISED_MARKERS = ['bacirecording'] as const;

/** Environment variable names. Values are never printed or journaled. */
export const ENV_API_KEY = 'PVB_PROOF_API_KEY';
/** Existing name used by the hosted staging savings-funding environment. */
export const ENV_API_KEY_FALLBACK = 'PIGGYVEST_SAVINGS_FUNDING_API_SECRET';
export const ENV_BASE_URL = 'PVB_PROOF_BASE_URL';
export const ENV_BANK_CODE = 'PVB_PROOF_BANK_CODE';
export const ENV_BANK_ACCOUNT = 'PVB_PROOF_BANK_ACCOUNT';
/** Ogabassey business SANDBOX wallet: proof 7's interest payout target and proofs 3 and 8's house wallet. */
export const ENV_BUSINESS_WALLET = 'PVB_PROOF_BUSINESS_WALLET_ID';

/** Hard money caps (kobo). The sandbox is not real money; caps limit blast radius. */
export const MAX_MUTATION_KOBO = 2_000_000;
export const MAX_RUN_TOTAL_KOBO = 6_000_000;

/** Amounts the proofs use (kobo). */
export const AMOUNTS_KOBO = {
  fundMain: 1_000_000,
  fundGoal: 200_000,
  walletTransfer: 100_000,
  bankOutflow: 100_000,
  /** Proof 3: the house-wallet inflow, which also funds proof 8's collection leg. */
  fundHouse: 200_000,
  /** Proof 9: a main-wallet deposit no other main-wallet credit shares. */
  depositMain: 250_000,
  /** S8 first pass: a main-wallet bank deposit (credited once). */
  s8DepositMain: 175_000,
  /** S8: main to goal funding, which is then tapped a second time. */
  s8FundGoal: 100_000,
  /** S8: the transfer whose submit times out. */
  s8TimeoutTransfer: 100_000,
} as const;

/**
 * Live polling budget per wait: 24 polls 5s apart (about two minutes; a
 * loop that sleeps after its read last observes at 115s, and steps that wait
 * twice take longer). The 2026-11-03 live runs showed the sandbox usually
 * settles in under 20s but sometimes far later, and 30s misread that as
 * unsettled.
 */
export const LIVE_POLL_INTERVAL_MS = 5_000;
export const LIVE_MAX_POLLS = 24;

/**
 * The S8 first pass may take out: the goal funding, a wire-level second tap
 * (only if the provider books it) and the transfer whose submit times out.
 */
export const S8_OUTFLOWS_KOBO =
  AMOUNTS_KOBO.s8FundGoal * 2 + AMOUNTS_KOBO.s8TimeoutTransfer;

/**
 * Everything the later proofs may take out of the main wallet: wallet
 * transfers in proofs 2 (plus a possible duplicate-reference second debit),
 * 4 and 8, and proof 4's bank outflow.
 */
export const PLANNED_OUTFLOWS_KOBO =
  AMOUNTS_KOBO.walletTransfer * 4 + AMOUNTS_KOBO.bankOutflow + S8_OUTFLOWS_KOBO;
/** Room for the bank-outflow fee (sandbox tariffs are tens of naira) and any transfer fee. */
export const FEE_RESERVE_KOBO = 50_000;
/** A main wallet below this is topped up before the proofs run. */
export const FUNDING_FLOOR_KOBO = PLANNED_OUTFLOWS_KOBO + FEE_RESERVE_KOBO;

/** Allowlisted POST paths in mutation mode. Everything else is refused. */
export const MUTATION_PATHS = [
  '/api/v1/customers',
  '/api/v1/wallet/sub-account',
  '/api/v1/transfer/wallet',
  '/api/v1/transfer/bank',
  '/api/v1/transfer/test/funding',
] as const;
export type MutationPath = (typeof MUTATION_PATHS)[number];

export const EVIDENCE_SCHEMA = 'piggyvest-contract-evidence/v1';
export const DEFAULT_EVIDENCE_DIR_FROM_REPO_ROOT =
  'docs/piggyvest-contract-evidence';
