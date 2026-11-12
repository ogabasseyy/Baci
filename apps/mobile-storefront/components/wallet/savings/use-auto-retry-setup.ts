import { useEffect, useState } from 'react';

/** Automatic re-starts of a stalled setup before asking the customer. */
export const AUTO_SETUP_RETRIES = 2;

/**
 * Re-starts a stalled goal-wallet setup by itself when the server says the
 * earlier attempt's claim has expired, so the customer never has to press a
 * button for a normal hiccup. At most AUTO_SETUP_RETRIES tries per goal;
 * after that `exhausted` is set and the screen offers a manual retry and
 * support. Starts over for another account or goal.
 */
export function useAutoRetrySetup({
  active,
  scopeKey,
  submitting,
  retry,
}: {
  active: boolean;
  scopeKey: string;
  submitting: boolean;
  /** Resolves true when a retry was actually sent. */
  retry: () => Promise<boolean>;
}) {
  const [tries, setTries] = useState({ scopeKey, count: 0 });
  const count = tries.scopeKey === scopeKey ? tries.count : 0;
  const exhausted = count >= AUTO_SETUP_RETRIES;

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry is a fresh closure each render; the scope and state identify the attempt.
  useEffect(() => {
    if (!active || submitting || exhausted) return;
    // Spend a try now (so this effect never sends twice); only real sends
    // keep it spent.
    setTries({ scopeKey, count: count + 1 });
    const giveBack = () =>
      setTries((current) =>
        current.scopeKey === scopeKey
          ? { scopeKey, count: Math.max(0, current.count - 1) }
          : current
      );
    // A deduped call (false) or one that threw before sending gives the try
    // back; a real send that failed still counts (its status is re-read).
    void retry()
      .then((sent) => {
        if (!sent) giveBack();
      })
      .catch(giveBack);
  }, [active, submitting, exhausted, scopeKey]);

  return { exhausted };
}
