import type { WalletPayOutcomeKind } from './wallet-pay.types';

// Answers that prove nothing about a payment already sent (a lost session,
// a paused service, a dropped start): the purchase keeps its key so the next
// tap resumes the same payment instead of paying again.
export const KEEP_OUTCOMES = new Set<WalletPayOutcomeKind>([
  'pending',
  'review',
  'sign_in',
  'unavailable',
  'not_started',
]);
// After a PIN, only a definite answer settles: delivered, refunded, short of
// money, or not completed. Anything else (an IMEI mismatch, a refusal) keeps
// the key, because the transfer may still be confirming.
export const PAY_SETTLES = new Set<WalletPayOutcomeKind>([
  'refunded',
  'insufficient',
  'not_completed',
]);
