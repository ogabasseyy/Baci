import { boundedMapSet } from '@/lib/bounded-map-set';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

/** After this long the setup is "taking longer than usual". */
export const GOAL_SETUP_FIRST_MINUTE_MS = 60_000;

type Entry = {
  firstWaitingAt: number | null;
  lastPhase: SavingsPlanFundingPhase;
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
  boundedMapSet(
    entries,
    scopeKey,
    {
      lastPhase: phase,
      firstWaitingAt: waiting ? (entry?.firstWaitingAt ?? now) : null,
    },
    MAX_REMEMBERED_GOALS
  );
}

export function lastGoalSetupPhase(
  scopeKey: string
): SavingsPlanFundingPhase | null {
  return entries.get(scopeKey)?.lastPhase ?? null;
}

export function goalSetupFirstWaitingAt(scopeKey: string): number | null {
  return entries.get(scopeKey)?.firstWaitingAt ?? null;
}

/** Tests only: forget everything. */
export function resetGoalSetupMemory(): void {
  entries.clear();
}
