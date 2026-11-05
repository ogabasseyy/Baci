import { useEffect, useRef, useState } from 'react';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

const POLL_MS = 5000;
const MAX_ATTEMPTS = 12;

/**
 * Keeps re-reading a goal wallet that is still being set up, every 5 s and at
 * most 12 times (a minute), then leaves the "check back shortly" text in
 * place. Reads are silent so the screen does not flicker, stop the moment the
 * goal is ready, and start over for another account or goal. Only reads
 * status; it never re-sends setup. A read that fails is retried on the next
 * tick; only when the last attempt also fails is `onExhausted` called with
 * that error, so one network blip never ends the automatic checks.
 */
export function useGoalWalletSetupPoll({
  phase,
  scopeKey,
  reread,
  onExhausted,
}: {
  phase: SavingsPlanFundingPhase;
  scopeKey: string;
  reread: (options: { silent: true }) => Promise<unknown>;
  onExhausted?: (error: unknown) => void;
}) {
  const lastFailure = useRef<{ error: unknown } | null>(null);
  const [attempt, setAttempt] = useState({ scopeKey, count: 0 });
  const count = attempt.scopeKey === scopeKey ? attempt.count : 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reread is a fresh closure each render; the scope is what identifies it.
  useEffect(() => {
    if (phase !== 'pending') {
      if (count !== 0) setAttempt({ scopeKey, count: 0 });
      return;
    }
    if (count >= MAX_ATTEMPTS) return;
    if (count === 0) lastFailure.current = null;
    let current = true;
    const timer = setTimeout(async () => {
      try {
        await reread({ silent: true });
        lastFailure.current = null;
      } catch (error) {
        lastFailure.current = { error };
      }
      if (!current) return;
      if (count + 1 >= MAX_ATTEMPTS && lastFailure.current) {
        onExhausted?.(lastFailure.current.error);
      }
      setAttempt({ scopeKey, count: count + 1 });
    }, POLL_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [phase, count, scopeKey]);

  // After every attempt has come back still pending the poll stops; the
  // customer can start it again by hand, which also reads once right away.
  const exhausted = phase === 'pending' && count >= MAX_ATTEMPTS;
  const checkAgain = () => {
    setAttempt({ scopeKey, count: 0 });
    void Promise.resolve(reread({ silent: true })).catch(() => undefined);
  };
  return { exhausted, checkAgain };
}
