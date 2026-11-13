import { useEffect, useRef, useState } from 'react';
import {
  usePiggyvestSlowdown,
  useReportPiggyvestSlow,
} from '@/hooks/use-piggyvest-slowdown';
import {
  GOAL_SETUP_FIRST_MINUTE_MS,
  goalSetupFirstWaitingAt,
  rememberGoalSetupPhase,
} from './goal-setup-memory';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

const FAST_POLL_MS = 5000;
const FAST_ATTEMPTS = 12;
/** After the first minute: keep going, just less often. */
const SLOW_POLL_MS = 20_000;
/**
 * Slow checks before pausing (about an hour on screen). "Check now", a new
 * goal or reopening the wallet starts the checks again.
 */
export const MAX_SLOW_ATTEMPTS = 180;

/**
 * Keeps re-reading a goal wallet that is still being set up while the screen
 * is open: every 5 s for the first minute, then every 20 s for about an hour
 * (then it pauses until "Check now" or the wallet reopens, so a wallet left
 * open never polls forever). The customer is never left on a dead end; after
 * the first minute `slow` is set so the screen can say it is taking a little
 * longer. Reads are silent, stop the moment the goal is ready, and start over
 * for another account or goal. `slow` also counts from when this app run
 * first saw the setup waiting, so closing and reopening the sheet never
 * brings back the "about a minute" promise or hides Check now. Only reads
 * status; it never re-sends setup. A
 * read that fails is retried on the next tick; if the last read of the first
 * minute also failed, `onExhausted` is called with that error, so one network
 * blip never ends the automatic checks.
 */
export function useGoalWalletSetupPoll({
  phase,
  scopeKey,
  reread,
  onExhausted,
  pendingSince,
}: {
  phase: SavingsPlanFundingPhase;
  scopeKey: string;
  reread: (options: { silent: true }) => Promise<unknown>;
  onExhausted?: (error: unknown) => void;
  /**
   * When setup really started (the plan's creation time, ms). "Slow" counts
   * from the earlier of this and when this app first saw the setup waiting,
   * so a plan pending for hours is slow on the very first open.
   */
  pendingSince?: number | null;
}) {
  const lastFailure = useRef<{ error: unknown } | null>(null);
  const [attempt, setAttempt] = useState({ scopeKey, count: 0 });
  const count = attempt.scopeKey === scopeKey ? attempt.count : 0;
  // While PiggyVest is slow, a failed read is shown as "getting ready", so
  // the checks must keep going through it too.
  const slowdown = usePiggyvestSlowdown();
  // An error this poll reported itself (its last quick read failed) keeps
  // the checks going too, so they recover on their own instead of stopping.
  const [selfErrored, setSelfErrored] = useState<string | null>(null);
  const active =
    phase === 'pending' ||
    (phase === 'error' && (slowdown || selfErrored === scopeKey));

  // biome-ignore lint/correctness/useExhaustiveDependencies: reread is a fresh closure each render; the scope is what identifies it.
  useEffect(() => {
    if (!active) {
      if (count !== 0) setAttempt({ scopeKey, count: 0 });
      if (selfErrored !== null && phase !== 'error') setSelfErrored(null);
      return;
    }
    if (count >= FAST_ATTEMPTS + MAX_SLOW_ATTEMPTS) return;
    if (count === 0) lastFailure.current = null;
    let current = true;
    const timer = setTimeout(
      async () => {
        try {
          await reread({ silent: true });
          lastFailure.current = null;
        } catch (error) {
          lastFailure.current = { error };
        }
        if (!current) return;
        if (count + 1 === FAST_ATTEMPTS && lastFailure.current) {
          setSelfErrored(scopeKey);
          onExhausted?.(lastFailure.current.error);
        }
        setAttempt({ scopeKey, count: count + 1 });
      },
      count < FAST_ATTEMPTS ? FAST_POLL_MS : SLOW_POLL_MS
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [active, count, scopeKey, phase]);

  // Waited past the first minute since this app first saw the setup waiting
  // (survives the sheet closing and reopening).
  const waiting = phase === 'pending' || phase === 'setup_retryable';
  const [overdueScope, setOverdueScope] = useState<string | null>(null);
  useEffect(() => {
    rememberGoalSetupPhase(scopeKey, phase);
    const seenAt = goalSetupFirstWaitingAt(scopeKey);
    const since =
      typeof pendingSince === 'number' && Number.isFinite(pendingSince)
        ? pendingSince
        : null;
    const firstAt =
      seenAt === null
        ? since
        : since === null
          ? seenAt
          : Math.min(seenAt, since);
    // Ready (or no longer waiting): a later stall starts its own minute.
    if (!waiting) {
      if (overdueScope !== null) setOverdueScope(null);
      return;
    }
    if (firstAt === null) return;
    const left = firstAt + GOAL_SETUP_FIRST_MINUTE_MS - Date.now();
    if (left <= 0) {
      setOverdueScope(scopeKey);
      return;
    }
    const timer = setTimeout(() => setOverdueScope(scopeKey), left);
    return () => clearTimeout(timer);
  }, [phase, scopeKey, waiting, overdueScope, pendingSince]);
  const overdue = waiting && overdueScope === scopeKey;

  const slow = (active && count >= FAST_ATTEMPTS) || overdue;
  // The hour-long window is used up: checks wait for Check now or a reopen.
  const paused = active && count >= FAST_ATTEMPTS + MAX_SLOW_ATTEMPTS;
  // Only a still-pending setup raises the signal: an errored read kept alive
  // by the signal must never renew it, or it would latch itself on.
  // A paused or idle check (e.g. the wallet card while the sheet checks the
  // same plan) has no say, so it never clears the sheet's signal.
  useReportPiggyvestSlow(
    'goal-setup',
    phase === 'idle' ? null : phase === 'pending' && slow
  );
  // Reads once right away and starts the quick checks again.
  const checkAgain = () => {
    setAttempt({ scopeKey, count: 0 });
    void Promise.resolve(reread({ silent: true })).catch(() => undefined);
  };
  return { slow, paused, checkAgain };
}
