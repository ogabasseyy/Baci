import { useEffect, useRef, useState } from 'react';
import { boundedMapSet } from '@/lib/bounded-map-set';

/** Automatic re-starts of a stalled setup before asking the customer. */
export const AUTO_SETUP_RETRIES = 2;

/**
 * Tries spent per goal (keyed by scope) for this app run, outside any one
 * screen: closing and reopening the wallet or sheet never refills them.
 */
const spentTries = new Map<string, number>();
/** Goals remembered at once; the oldest is forgotten first. */
const MAX_REMEMBERED_GOALS = 64;
const setTriesFor = (scopeKey: string, count: number) =>
  boundedMapSet(spentTries, scopeKey, count, MAX_REMEMBERED_GOALS);
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
  /** Never retry by itself; hand over at once (the caller decides when). */
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
  // An automatic retry is running (the last one may still succeed).
  const [inFlight, setInFlight] = useState(false);
  // A sent retry waits for the status to be read again (the caller leaves
  // the retryable phase while it re-reads), so the next try answers a fresh
  // stalled reading and both tries are never spent back to back.
  const awaitingReread = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry is a fresh closure each render; the scope and state identify the attempt.
  useEffect(() => {
    if (!active) {
      awaitingReread.current = null;
      return;
    }
    if (submitting || exhausted || awaitingReread.current === scopeKey) return;
    awaitingReread.current = scopeKey;
    // Spend a try now (so this effect never sends twice); only real sends
    // keep it spent.
    setTriesFor(scopeKey, count + 1);
    setTries({ scopeKey, count: count + 1 });
    const giveBack = () => {
      // Nothing was sent, so no re-read is coming: the next change may retry.
      if (awaitingReread.current === scopeKey) awaitingReread.current = null;
      const left = Math.max(0, triesFor(scopeKey) - 1);
      setTriesFor(scopeKey, left);
      setTries((current) =>
        current.scopeKey === scopeKey ? { scopeKey, count: left } : current
      );
    };
    // A deduped call (false) or one that threw before sending gives the try
    // back; a real send that failed still counts (its status is re-read).
    setInFlight(true);
    void retry()
      .then((sent) => {
        if (!sent) giveBack();
      })
      .catch(giveBack)
      .finally(() => setInFlight(false));
  }, [active, submitting, exhausted, scopeKey]);

  return { exhausted, inFlight };
}
