import { boundedMapSet } from '@/lib/bounded-map-set';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

/** After this long the setup is "taking longer than usual". */
export const GOAL_SETUP_FIRST_MINUTE_MS = 60_000;

type Entry = {
  firstWaitingAt: number | null;
  /** Seen not started, then waiting: setup began after the plan was made. */
  startedLater: boolean;
  lastPhase: SavingsPlanFundingPhase;
  /** When `lastPhase` last changed, so screens can tell newer answers. */
  updatedAt: number;
};

/**
 * What this app run already learned about each goal's wallet setup (keyed by
 * account, merchant and goal), kept outside any one screen so closing and
 * reopening the savings sheet does not forget it:
 * - when the app first saw the setup still waiting, so the "about a minute"
 *   promise ends a minute after that, not a minute after every reopen;
 * - the last settled status, so a reopened sheet shows that state while the
 *   fresh status read is in flight instead of flashing the amount entry.
 * It never holds money or personal data, only a status word and a time.
 */
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

/** Calls `listener` whenever a goal's remembered status changes. */
export function subscribeGoalSetupMemory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/** Goals remembered at once; the oldest is forgotten first. */
const MAX_REMEMBERED_GOALS = 64;

const SETTLED: readonly SavingsPlanFundingPhase[] = [
  'ready',
  'pending',
  'setup_retryable',
  'not_started',
  'unavailable',
];

export function rememberGoalSetupPhase(
  scopeKey: string,
  phase: SavingsPlanFundingPhase,
  now: number = Date.now()
): void {
  if (!SETTLED.includes(phase)) return;
  const entry = entries.get(scopeKey);
  const waiting = phase === 'pending' || phase === 'setup_retryable';
  const changed = entry?.lastPhase !== phase;
  boundedMapSet(
    entries,
    scopeKey,
    {
      lastPhase: phase,
      updatedAt: changed ? now : (entry?.updatedAt ?? now),
      firstWaitingAt: waiting ? (entry?.firstWaitingAt ?? now) : null,
      startedLater: waiting
        ? (entry?.startedLater ?? false) || entry?.lastPhase === 'not_started'
        : false,
    },
    MAX_REMEMBERED_GOALS
  );
  if (changed) for (const listener of listeners) listener();
}

export function lastGoalSetupPhase(
  scopeKey: string
): SavingsPlanFundingPhase | null {
  return entries.get(scopeKey)?.lastPhase ?? null;
}

/**
 * True when this app run saw the goal's setup not started and then waiting:
 * the customer started setup long after creating the plan, so the plan's
 * creation time says nothing about how long setup has been running.
 */
export function goalSetupStartedLater(scopeKey: string): boolean {
  return entries.get(scopeKey)?.startedLater ?? false;
}

/** When the goal's remembered status last changed; 0 if never learned. */
export function goalSetupPhaseUpdatedAt(scopeKey: string): number {
  return entries.get(scopeKey)?.updatedAt ?? 0;
}

export function goalSetupFirstWaitingAt(scopeKey: string): number | null {
  return entries.get(scopeKey)?.firstWaitingAt ?? null;
}

/** Tests only: forget everything. */
export function resetGoalSetupMemory(): void {
  entries.clear();
  for (const listener of listeners) listener();
}
