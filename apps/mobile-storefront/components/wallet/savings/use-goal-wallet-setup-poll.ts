import { useEffect, useState } from 'react';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

const POLL_MS = 5000;
const MAX_ATTEMPTS = 12;

/**
 * Keeps re-reading a goal wallet that is still being set up, every 5 s and at
 * most 12 times (a minute), then leaves the "check back shortly" text in
 * place. Reads are silent so the screen does not flicker, stop the moment the
 * goal is ready, and start over for another account or goal. Only reads
 * status; it never re-sends setup.
 */
export function useGoalWalletSetupPoll({
  phase,
  scopeKey,
  reread,
}: {
  phase: SavingsPlanFundingPhase;
  scopeKey: string;
  reread: (options: { silent: true }) => Promise<unknown>;
}) {
  const [attempt, setAttempt] = useState({ scopeKey, count: 0 });
  const count = attempt.scopeKey === scopeKey ? attempt.count : 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reread is a fresh closure each render; the scope is what identifies it.
  useEffect(() => {
    if (phase !== 'pending') {
      if (count !== 0) setAttempt({ scopeKey, count: 0 });
      return;
    }
    if (count >= MAX_ATTEMPTS) return;
    let current = true;
    const timer = setTimeout(async () => {
      await reread({ silent: true });
      if (current) setAttempt({ scopeKey, count: count + 1 });
    }, POLL_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [phase, count, scopeKey]);
}
