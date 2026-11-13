import { useEffect, useRef, useState } from 'react';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { GoalActionKind } from '@/schemas/goal-lifecycle';
import { useAuthStore } from '@/stores/auth-store';
import { clearSavingsNotice } from './savings-notice';
import { useGoalLifecycle } from './use-goal-lifecycle';

const IN_FLIGHT = new Set(['submitting', 'polling']);

/**
 * Cancelling or completing a goal as a step inside the Add to savings sheet.
 * The goal being acted on is held (pinned to the signed-in account) so the step keeps its
 * subject even after a wallet refresh drops the cancelled goal.
 */
export function useInSheetGoalCancel(
  goal: WalletActiveSavingsGoal | null,
  refreshWallet?: () => unknown,
  /** Whether the savings sheet is showing; reopening keeps a held step. */
  sheetVisible = true
) {
  const userId = useAuthStore((state) => state.user?.id);
  const merchantId = useAuthStore((state) => state.merchantId ?? undefined);
  const [held, setHeld] = useState<{
    goal: WalletActiveSavingsGoal;
    kind: GoalActionKind;
    userId: string | undefined;
    merchantId: string | undefined;
  } | null>(null);
  // Held for the account AND store it was opened in: another store never
  // sees (or acts on) this goal.
  const active =
    held && held.userId === userId && held.merchantId === merchantId
      ? held.goal
      : null;
  const kind: GoalActionKind = held?.kind ?? 'cancel';
  // Each time the step opens it starts fresh, never on a stale outcome.
  const [attempt, setAttempt] = useState(0);
  // A held action belongs to the account and store it was opened in: when
  // either changes it is dropped, never hidden to come back on a switch back.
  const scopeChanged =
    held !== null && (held.userId !== userId || held.merchantId !== merchantId);
  useEffect(() => {
    if (!scopeChanged) return;
    setHeld(null);
    setAttempt((value) => value + 1);
  }, [scopeChanged]);
  const flow = useGoalLifecycle({
    kind,
    goalId: active?.id ?? goal?.id ?? '',
    resetKey: attempt,
  });
  // Refresh once an action actually settles (or may have), whether or not
  // the sheet is still open.
  // Exactly once per attempt: the refresh callback is a new function on
  // every wallet render, so it must not drive the effect.
  const settled = flow.step === 'done' || flow.step === 'timed_out';
  const refreshRef = useRef(refreshWallet);
  refreshRef.current = refreshWallet;
  // Keyed by outcome too: a timed-out attempt that later confirms after
  // "Check again" refreshes again, once.
  const refreshed = useRef<string | null>(null);
  const outcomeKey = settled ? `${attempt}:${flow.step}` : null;
  // A sheet closed mid-save keeps its goal only until the action settles,
  // unless it is opened again first (then its status stays on screen).
  const closedInFlight = useRef<number | null>(null);
  useEffect(() => {
    if (sheetVisible) closedInFlight.current = null;
  }, [sheetVisible]);
  useEffect(() => {
    if (!outcomeKey || refreshed.current === outcomeKey) return;
    refreshed.current = outcomeKey;
    void refreshRef.current?.();
    if (closedInFlight.current === attempt) {
      closedInFlight.current = null;
      setHeld(null);
    }
  }, [outcomeKey, attempt]);

  return {
    goal: active,
    kind,
    flow,
    start: (next: GoalActionKind = 'cancel') => {
      if (!goal) return;
      // Earlier news ("Savings updated" for this plan) never outlives the
      // plan: cancelling or completing starts with a clean slate.
      clearSavingsNotice();
      setAttempt((value) => value + 1);
      setHeld({ goal, kind: next, userId, merchantId });
    },
    /** Back to the savings view; nothing was sent unless the flow says so. */
    keep: () => setHeld(null),
    /**
     * The sheet closed. An action still being saved stays tracked, so its
     * result refreshes the wallet when it settles; anything else is dropped.
     */
    closed: () => {
      if (IN_FLIGHT.has(flow.step)) {
        closedInFlight.current = attempt;
        return;
      }
      setHeld(null);
      // Anything not yet sent (e.g. still issuing) is abandoned: a new
      // attempt invalidates it, so a late reply never opens a hidden PIN step.
      setAttempt((value) => value + 1);
    },
  };
}
