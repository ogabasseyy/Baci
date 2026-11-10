// useEffectEvent is stable React since 19.2; this app pins react 19.3.0.
import { useEffect, useEffectEvent, useState } from 'react';

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
 * number and balance until something reloads it. Re-check by itself a few
 * times, a few seconds apart, while the answer is unknown: the late answer is
 * remembered, so the next load can show it even if PiggyVest is still slow.
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
  const retry = useEffectEvent(() => {
    setState({ scopeKey, attempts: attempts + 1 });
    void refetch();
  });
  useEffect(() => {
    if (!unknown || attempts >= PRIMARY_UNKNOWN_RETRY_LIMIT) return;
    const timer = setTimeout(retry, PRIMARY_UNKNOWN_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [unknown, attempts]);
}
