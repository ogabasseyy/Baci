import { createHash } from 'node:crypto';
import { PIGGYVEST_SUBACCOUNT_NAME_MAX_CHARACTERS as MAX } from '@/lib/piggyvest/provider-wallet-name.constants';

/**
 * QA goal wallet names. PiggyVest refuses a subaccount_name over 50
 * characters with 422 (staging probe, 2026-10-31), so every name the
 * harness sends is built and length-checked here.
 */

const PREFIX = 'pvbproof-goal-';
// Room reserved for the suffix a proof appends ('-u' or '-x' plus a 1-2
// digit attempt) when choosing the base name.
const SUFFIX_MAX = 4;

/**
 * Keeps the readable `pvbproof-goal-<qaKey>` whenever a suffix still fits,
 * so goal wallets created earlier are found by name; a longer key (up to the
 * journal's 64 characters) is hashed in full, never truncated, so two keys
 * sharing a prefix never share a goal wallet.
 */
export function goalWalletBaseName(qaKey: string): string {
  const readable = `${PREFIX}${qaKey}`;
  if (readable.length + SUFFIX_MAX <= MAX) return readable;
  const digest = createHash('sha256').update(qaKey).digest('hex');
  return `${PREFIX}h${digest.slice(0, 24)}`;
}

/** The name sent to the provider; throws rather than send a certain 422. */
export function goalWalletName(base: string, suffix = ''): string {
  const name = `${base}${suffix}`;
  if (name.length > MAX)
    throw new Error(`QA goal wallet name exceeds ${MAX} characters`);
  return name;
}

/** Proof 7's per-attempt goal variants: payout left unset, or explicit. */
export function p7GoalSuffix(
  variant: 'unset' | 'explicit',
  attempt: number
): string {
  return `-${variant === 'unset' ? 'u' : 'x'}${attempt}`;
}
