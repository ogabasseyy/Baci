/** Finding kinds and matching constants for the credit-gap check (credit-gap-reconciliation.ts). */
export const SETTLE_MS = 6 * 3_600_000;
/** PVB credit ids are `PVB01…` (PiggyVest, 2026-11-11). */
export const PVB_CREDIT_ID = /^PVB01/;
/**
 * Wallet-to-wallet categories (our own savings transfers), compared trimmed
 * and lower-cased. Only `p2p` has been observed; an unknown category still
 * pages, which fails loud rather than silently skipping money.
 */
export const INTERNAL_CATEGORIES: ReadonlySet<string> = new Set(['p2p']);
export const EDGE_MS = 3_600_000;

export type CreditGapKind =
  | 'unrecorded_credit'
  | 'not_on_provider'
  | 'interest_not_listed'
  | 'partial_credit'
  | 'unverified_reference'
  | 'list_namespace_unproven';

/** Findings listed for a person to review that never page on their own. */
export const REVIEW_ONLY: ReadonlySet<CreditGapKind> = new Set([
  'interest_not_listed',
  'partial_credit',
  'unverified_reference',
]);
