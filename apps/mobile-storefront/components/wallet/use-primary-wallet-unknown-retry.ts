// useEffectEvent is stable React since 19.2; this app pins react 19.3.0.
import { useEffect, useEffectEvent, useState } from 'react';
import { onLatePrimaryAnswer } from '@/hooks/primary-funding-account-memory';

export const PRIMARY_UNKNOWN_RETRY_DELAY_MS = 4000;
export const PRIMARY_UNKNOWN_RETRY_LIMIT = 3;

interface Input {
  /** The wallet's PiggyVest read came back unknown (slow or failed). */
  unknown: boolean;
  /** Account + merchant scope; a change restarts the retries. */
  scopeKey: string;
  refetch: () => unknown;
}

/**
 * A slow PiggyVest read leaves the wallet without the customer's account
 * number and balance until something reloads it. While the answer is
 * unknown: reload as soon as a late confirmed answer lands, and otherwise
 * re-check by itself a few times. Each re-check waits for the previous reload
 * to finish, so reloads never overlap and every attempt really runs.
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
  const retry = useEffectEvent(async (forScope: string) => {
    try {
      await refetch();
    } catch {
      // A failed reload still spends the attempt; the next one may succeed.
    } finally {
      // Spend the attempt only once the reload has settled.
      setState((current) =>
        current.scopeKey === forScope
          ? { scopeKey: forScope, attempts: current.attempts + 1 }
          : current
      );
    }
  });
  const reloadForLateAnswer = useEffectEvent(() => {
    if (unknown) void refetch();
  });
  useEffect(() => onLatePrimaryAnswer(reloadForLateAnswer), []);
  useEffect(() => {
    if (!unknown || attempts >= PRIMARY_UNKNOWN_RETRY_LIMIT) return;
    // Bound to this scope: an account switch clears it and starts afresh.
    const forScope = scopeKey;
    const timer = setTimeout(() => {
      void retry(forScope);
    }, PRIMARY_UNKNOWN_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [unknown, attempts, scopeKey]);
}
