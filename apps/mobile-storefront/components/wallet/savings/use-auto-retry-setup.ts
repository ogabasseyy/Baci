import { useEffect, useState } from 'react';

/** Automatic re-starts of a stalled setup before asking the customer. */
export const AUTO_SETUP_RETRIES = 2;

/**
 * Tries spent per goal (keyed by scope) for this app run, outside any one
 * screen: closing and reopening the wallet or sheet never refills them.
 */
const spentTries = new Map<string, number>();
const triesFor = (scopeKey: string) => spentTries.get(scopeKey) ?? 0;

/** Tests only: forget every spent try. */
export function resetAutoSetupRetries(): void {
  spentTries.clear();
}

/**
 * Re-starts a stalled goal-wallet setup by itself when the server says the
 * earlier attempt's claim has expired, so the customer never has to press a
 * button for a normal hiccup. At most AUTO_SETUP_RETRIES tries per goal for
 * the app run (reopening the screen does not refill them); after that
 * `exhausted` is set and the screen offers a manual retry and support.
 */
export function useAutoRetrySetup({
  active,
  blocked = false,
  scopeKey,
  submitting,
  retry,
}: {
  active: boolean;
  /** Never retry by itself (e.g. a BVN is required): hand over at once. */
  blocked?: boolean;
  scopeKey: string;
  submitting: boolean;
  /** Resolves true when a retry was actually sent. */
  retry: () => Promise<boolean>;
}) {
  // Seeded from the per-goal count, so a remount keeps the tries spent.
  const [tries, setTries] = useState(() => ({
    scopeKey,
    count: triesFor(scopeKey),
  }));
  const count = tries.scopeKey === scopeKey ? tries.count : triesFor(scopeKey);
  const exhausted = blocked || count >= AUTO_SETUP_RETRIES;

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry is a fresh closure each render; the scope and state identify the attempt.
  useEffect(() => {
    if (!active || submitting || exhausted) return;
    // Spend a try now (so this effect never sends twice); only real sends
    // keep it spent.
    spentTries.set(scopeKey, count + 1);
    setTries({ scopeKey, count: count + 1 });
    const giveBack = () => {
      const left = Math.max(0, triesFor(scopeKey) - 1);
      spentTries.set(scopeKey, left);
      setTries((current) =>
        current.scopeKey === scopeKey ? { scopeKey, count: left } : current
      );
    };
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
