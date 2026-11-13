import { useEffect, useRef, useState } from 'react';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { GoalActionKind } from '@/schemas/goal-lifecycle';
import { useAuthStore } from '@/stores/auth-store';
import { walletRefreshWorked } from '../wallet-refresh-worked';
import { clearSavingsNotice, savingsNotifier } from './savings-notice';
import { useGoalLifecycle } from './use-goal-lifecycle';

// Steps whose reply can still settle money (an issue may answer "already
// pending" or, for Complete, "confirmed"): a closed sheet keeps tracking them.
const IN_FLIGHT = new Set(['issuing', 'submitting', 'polling']);

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
    goalTitle: active?.title ?? goal?.title,
    resetKey: attempt,
  });
  // Refresh once an action actually settles (or may have), whether or not
  // the sheet is still open.
  // Exactly once per attempt: the refresh callback is a new function on
  // every wallet render, so it must not drive the effect.
  // needs_review counts too: reconciliation may already have seen the money
  // move, and refreshing after an issue-time review is harmless.
  const settled =
    flow.step === 'done' ||
    flow.step === 'timed_out' ||
    flow.step === 'needs_review';
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
    const refresh = refreshRef.current;
    if (refresh) {
      // A refetch that resolves with an error counts as failed; one retry,
      // then the customer is told to pull down for the latest balance.
      const notify = savingsNotifier();
      const once = () => Promise.resolve(refresh());
      void (async () => {
        for (let tries = 0; tries < 2; tries += 1) {
          if (await walletRefreshWorked(once)) return;
        }
        notify(
          'Pull to refresh',
          'Your savings changed. Pull down on the wallet to see the latest.',
          'info'
        );
      })();
    }
  }, [outcomeKey]);
  // Every final outcome, refreshed or not (a definite refusal included),
  // releases an action whose sheet was closed while it was in flight.
  const finished =
    settled || flow.step === 'failed' || flow.step === 'pin_cancelled';
  useEffect(() => {
    if (closedInFlight.current !== attempt) return;
    if (flow.step === 'pin') {
      // An issue closed mid-flight that now needs the PIN: nothing was sent,
      // so it is abandoned rather than opening a hidden PIN prompt.
      closedInFlight.current = null;
      setHeld(null);
      setAttempt((value) => value + 1);
      return;
    }
    if (!finished) return;
    closedInFlight.current = null;
    setHeld(null);
  }, [finished, attempt, flow.step]);

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
      // Anything not yet sent (a review, a PIN step) is abandoned: a new
      // attempt invalidates it, so a late reply never opens a hidden PIN step.
      setAttempt((value) => value + 1);
    },
  };
}
