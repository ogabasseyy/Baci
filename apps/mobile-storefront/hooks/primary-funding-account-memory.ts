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

type KeyState = {
  /** Sequence of the latest read started for this merchant and user. */
  started: number;
  /** Sequence of the newest read whose answer has been applied. */
  applied: number;
  entry?: { userId: string; at: number; value: ConfirmedPrimaryRead };
};

const states = new Map<string, KeyState>();
const lateAnswerListeners = new Set<(scopeKey: string) => void>();

function stateOf(merchantId: string, userId: string): KeyState {
  const key = `${merchantId}\u0000${userId}`;
  let state = states.get(key);
  if (!state) {
    state = { started: 0, applied: 0 };
    states.set(key, state);
  }
  return state;
}

/** Numbers a read as it starts, so answers can be applied in start order. */
export function beginPrimaryRead(merchantId: string, userId: string): number {
  const state = stateOf(merchantId, userId);
  state.started += 1;
  return state.started;
}

/**
 * Applies a read's answer unless a read started after it has already
 * answered, so a slow older read never overwrites a newer balance or brings
 * back an account a newer answer cleared. A confirmed account (ready, with an
 * account number and a whole-kobo balance) becomes the remembered read; an authoritative "not ready"
 * or "no account yet" clears it; an unknown answer changes nothing. Returns
 * whether a confirmed account was stored. `sequence` comes from
 * `beginPrimaryRead`, called when the read started.
 */
function isWholeKobo(kobo: number | null): boolean {
  return typeof kobo === 'number' && Number.isSafeInteger(kobo) && kobo >= 0;
}

export function rememberPrimaryFundingAccount(
  merchantId: string,
  userId: string,
  value: SettledPrimaryFundingAccount,
  sequence: number
): boolean {
  // A ready answer without a usable balance can't stand in for the money, so
  // it counts as unknown and never replaces a remembered full read.
  if (
    value.status === 'unavailable' ||
    (value.status === 'ready' &&
      value.account &&
      !isWholeKobo(value.balanceKobo))
  )
    return false;
  const state = stateOf(merchantId, userId);
  if (sequence <= state.applied) return false;
  state.applied = sequence;
  if (value.status !== 'ready' || !value.account) {
    state.entry = undefined;
    return false;
  }
  state.entry = { userId, at: Date.now(), value };
  return true;
}

/**
 * The last confirmed read for this merchant and user, or null when there is
 * none, it is too old, or a different account is signed in now.
 */
export function recallPrimaryFundingAccount(
  merchantId: string,
  userId: string
): ConfirmedPrimaryRead | null {
  const state = stateOf(merchantId, userId);
  const entry = state.entry;
  if (!entry) return null;
  if (
    Date.now() - entry.at > REMEMBERED_PRIMARY_READ_TTL_MS ||
    useAuthStore.getState().user?.id !== entry.userId
  ) {
    state.entry = undefined;
    return null;
  }
  return entry.value;
}

/**
 * The wallet screen's scope for a signed-in user at a merchant; the same
 * `user:merchant` form WalletScreen passes to the primary wallet watch.
 */
export function primaryScopeKey(userId: string, merchantId: string): string {
  return `${userId}:${merchantId}`;
}

/**
 * Subscribes to confirmed answers that arrived after their wallet load had
 * already given up, so a screen showing "unknown" can reload and show them.
 */
export function onLatePrimaryAnswer(
  listener: (scopeKey: string) => void
): () => void {
  lateAnswerListeners.add(listener);
  return () => {
    lateAnswerListeners.delete(listener);
  };
}

export function announceLatePrimaryAnswer(merchantId: string, userId: string) {
  const scopeKey = primaryScopeKey(userId, merchantId);
  for (const listener of lateAnswerListeners) {
    // One screen's failure never stops the others or the read itself.
    try {
      listener(scopeKey);
    } catch {
      // The screen still reloads on its own retry or next open.
    }
  }
}

/** Test hook: drops every remembered read and listener. */
export function forgetRememberedPrimaryFundingAccounts() {
  states.clear();
  lateAnswerListeners.clear();
}
