// useEffectEvent is stable React since 19.2; this app pins react 19.3.0.
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { onLatePrimaryAnswer } from '@/hooks/primary-funding-account-memory';

export const PRIMARY_UNKNOWN_RETRY_DELAY_MS = 4000;
export const PRIMARY_UNKNOWN_RETRY_LIMIT = 3;
/** After the quick attempts: a slow, steady re-check while still unknown. */
export const PRIMARY_UNKNOWN_SLOW_RETRY_DELAY_MS = 30_000;
/** Slow re-checks before giving up until the screen reloads (~5 minutes). */
export const PRIMARY_UNKNOWN_SLOW_RETRY_LIMIT = 10;

interface Input {
  /** The wallet's PiggyVest read came back unknown (slow or failed). */
  unknown: boolean;
  /** `primaryScopeKey(user, merchant)`; a change restarts the retries. */
  scopeKey: string;
  refetch: () => unknown;
}

/**
 * A slow PiggyVest read leaves the wallet without the customer's account
 * number and balance (or showing one recalled from moments ago) until
 * something reloads it. While the answer is unknown or recalled: re-check a
 * few times quickly, reloading as soon as a late confirmed answer lands, then
 * keep re-checking slowly for a few minutes so a recalled balance never
 * stands for long, then stop until the screen reloads. Late
 * answers spend the same quick attempts, so a provider that always answers
 * late cannot drive a reload loop. One reload runs at a time.
 */
export function usePrimaryWalletUnknownRetry({
  unknown,
  scopeKey,
  refetch,
}: Input) {
  // State, not a ref: reset during render behind a converging guard
  // (React's "adjust state when props change" pattern, compiler-safe).
  const [state, setState] = useState({ scopeKey, attempts: 0 });
  const attempts = state.scopeKey === scopeKey ? state.attempts : 0;
  if (state.scopeKey !== scopeKey || (!unknown && state.attempts !== 0)) {
    setState({ scopeKey, attempts: 0 });
  }
  // The ref blocks a second start within one tick; the state re-arms the
  // timer once any reload (even an older account's) has settled.
  const inFlight = useRef(false);
  const [reloading, setReloading] = useState(false);
  const retry = useEffectEvent(async (forScope: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setReloading(true);
    try {
      await refetch();
    } catch {
      // A failed reload still spends the attempt; the next one may succeed.
    }
    inFlight.current = false;
    setReloading(false);
    // Spend the attempt only once the reload has settled.
    setState((current) =>
      current.scopeKey === forScope
        ? { scopeKey: forScope, attempts: current.attempts + 1 }
        : current
    );
  });
  // Only an answer for this screen's own account and merchant counts.
  const reloadForLateAnswer = useEffectEvent((answeredScope: string) => {
    if (
      answeredScope === scopeKey &&
      unknown &&
      attempts < PRIMARY_UNKNOWN_RETRY_LIMIT
    )
      void retry(scopeKey);
  });
  useEffect(() => onLatePrimaryAnswer(reloadForLateAnswer), []);
  useEffect(() => {
    if (
      !unknown ||
      reloading ||
      attempts >= PRIMARY_UNKNOWN_RETRY_LIMIT + PRIMARY_UNKNOWN_SLOW_RETRY_LIMIT
    )
      return;
    // Bound to this scope: an account switch clears it and starts afresh.
    const forScope = scopeKey;
    const delay =
      attempts < PRIMARY_UNKNOWN_RETRY_LIMIT
        ? PRIMARY_UNKNOWN_RETRY_DELAY_MS
        : PRIMARY_UNKNOWN_SLOW_RETRY_DELAY_MS;
    const timer = setTimeout(() => {
      void retry(forScope);
    }, delay);
    return () => clearTimeout(timer);
  }, [unknown, reloading, attempts, scopeKey]);
}
