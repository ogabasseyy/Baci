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
/** Ogabassey business SANDBOX wallet used as the interest payout target (proof 7). */
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
} as const;

/** Everything the later proofs take out of the main wallet: two wallet transfers and one bank outflow. */
export const PLANNED_OUTFLOWS_KOBO =
  AMOUNTS_KOBO.walletTransfer * 2 + AMOUNTS_KOBO.bankOutflow;
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
