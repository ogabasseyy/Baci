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
const lateAnswerListeners = new Set<() => void>();

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
 * account number) becomes the remembered read; an authoritative "not ready"
 * or "no account yet" clears it; an unknown answer changes nothing. Returns
 * whether a confirmed account was stored. Omitting `sequence` treats the
 * answer as the newest read (for example, the setup sheet's own check).
 */
export function rememberPrimaryFundingAccount(
  merchantId: string,
  userId: string,
  value: SettledPrimaryFundingAccount,
  sequence: number = beginPrimaryRead(merchantId, userId)
): boolean {
  if (value.status === 'unavailable') return false;
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
 * Subscribes to confirmed answers that arrived after their wallet load had
 * already given up, so a screen showing "unknown" can reload and show them.
 */
export function onLatePrimaryAnswer(listener: () => void): () => void {
  lateAnswerListeners.add(listener);
  return () => {
    lateAnswerListeners.delete(listener);
  };
}

export function announceLatePrimaryAnswer() {
  for (const listener of lateAnswerListeners) {
    // One screen's failure never stops the others or the read itself.
    try {
      listener();
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
