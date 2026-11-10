import { useAuthStore } from '@/stores/auth-store';
import type { SettledPrimaryFundingAccount } from './resolve-wallet-funding-account';

/**
 * How long the last confirmed PiggyVest account read may stand in for a
 * fresh read that failed or ran slow. Long enough to cover moving between
 * wallet screens, short enough that an old balance never lingers. A stand-in
 * only ever replaces "unknown": any fresh answer wins.
 */
export const REMEMBERED_PRIMARY_READ_TTL_MS = 120_000;

type ConfirmedPrimaryRead = Extract<
  SettledPrimaryFundingAccount,
  { status: 'ready' }
>;

type Entry = {
  userId: string;
  at: number;
  value: ConfirmedPrimaryRead;
};

const entries = new Map<string, Entry>();

function keyOf(merchantId: string, userId: string) {
  return `${merchantId}\u0000${userId}`;
}

/**
 * Records a read as the last confirmed one when it is ready with an account
 * number. An authoritative "not ready" clears it, so a closed account is
 * never shown again; an unknown result leaves it untouched.
 */
export function rememberPrimaryFundingAccount(
  merchantId: string,
  userId: string,
  value: SettledPrimaryFundingAccount
) {
  const key = keyOf(merchantId, userId);
  if (value.status === 'not_ready') {
    entries.delete(key);
    return;
  }
  if (value.status !== 'ready' || !value.account) return;
  entries.set(key, { userId, at: Date.now(), value });
}

/**
 * The last confirmed read for this merchant and user, or null when there is
 * none, it is too old, or a different account is signed in now.
 */
export function recallPrimaryFundingAccount(
  merchantId: string,
  userId: string
): ConfirmedPrimaryRead | null {
  const key = keyOf(merchantId, userId);
  const entry = entries.get(key);
  if (!entry) return null;
  if (
    Date.now() - entry.at > REMEMBERED_PRIMARY_READ_TTL_MS ||
    useAuthStore.getState().user?.id !== entry.userId
  ) {
    entries.delete(key);
    return null;
  }
  return entry.value;
}

/** Test hook: drops every remembered read. */
export function forgetRememberedPrimaryFundingAccounts() {
  entries.clear();
}
