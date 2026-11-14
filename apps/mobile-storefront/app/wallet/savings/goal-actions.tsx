import { type Href, Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import GoalLinkLoadError from '@/components/wallet/savings/GoalLinkLoadError';
import { isFundedUnsettledGoal } from '@/components/wallet/savings/goal-settlement';
import { notifySavings } from '@/components/wallet/savings/savings-notice';
import { useSavingsNoticeStore } from '@/components/wallet/savings/savings-notice-store';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { useWallet } from '@/hooks/use-wallet';
import { goalIdParamSchema } from '@/schemas/goal-link';

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/** How long the link waits on a silent read before offering a retry. */
const SLOW_MS = 15_000;

type WaitPhase = 'wait' | 'slow' | 'stuck';

/**
 * What the link shows before it redirects: a spinner, or a retry notice when
 * a read failed (Try again re-reads) or has said nothing for SLOW_MS (Keep
 * waiting restarts the wait; the wallet read keeps going on its own). A read
 * still silent after that second wait counts as failed: Try again re-reads.
 */
function GoalLinkShell({
  onRetry,
  reread,
}: {
  onRetry?: () => void;
  /** Starts a new wallet read when a hung read is given up on. */
  reread?: () => void;
}) {
  const [phase, setPhase] = useState<WaitPhase>('wait');
  const [waited, setWaited] = useState(false);
  // Each quiet spell gets its own timer; Keep waiting starts a new one.
  useEffect(() => {
    if (onRetry || phase !== 'wait') return;
    const timer = setTimeout(
      () => setPhase(waited ? 'stuck' : 'slow'),
      SLOW_MS
    );
    return () => clearTimeout(timer);
  }, [onRetry, phase, waited]);
  const keepWaiting = () => {
    setWaited(true);
    setPhase('wait');
  };
  const startOver = () => {
    reread?.();
    setWaited(false);
    setPhase('wait');
  };
  const stuck = phase === 'stuck';
  const retry =
    onRetry ?? (stuck ? startOver : phase === 'slow' ? keepWaiting : undefined);
  return (
    <StorefrontScreenShell themeBackground>
      <Stack.Screen options={{ title: 'Savings' }} />
      {retry ? (
        <GoalLinkLoadError onRetry={retry} slow={!onRetry && !stuck} />
      ) : (
        <ActivityIndicator
          accessibilityLabel="Opening your savings"
          style={{ flex: 1 }}
        />
      )}
    </StorefrontScreenShell>
  );
}

/**
 * Cancel and Complete now happen inside the savings sheet on the wallet. Old
 * links to the full-page screen open that sheet for the same goal instead;
 * the customer picks Cancel or Complete there (the old `kind` is not acted
 * on, so a link can never start a money action by itself). A signed-out
 * customer signs in first and comes back to the same goal.
 */
export default function WalletGoalActionsRoute() {
  const params = useLocalSearchParams<{ goalId?: string | string[] }>();
  const auth = useRequireAuth();
  const wallet = useWallet();
  // Only a well-formed goal id is passed on; anything else opens the wallet.
  const parsed = goalIdParamSchema.safeParse(first(params.goalId));
  const goalId = parsed.success ? parsed.data : undefined;
  const goals = wallet.data?.wallet?.savings_goals ?? [];
  // A completed goal with nothing left to move stays in the list but has no
  // action left: treat it as closed, like a cancelled one.
  const owned = goals.some(
    (goal) =>
      goal.id === goalId &&
      (goal.status !== 'completed' || isFundedUnsettledGoal(goal))
  );
  // Every link gets one fresh read before it is followed: a goal missing
  // from the cached wallet may have been created elsewhere, and one present
  // in it may have closed elsewhere since the last read.
  const needsCheck = Boolean(
    goalId && wallet.data && !auth.isLoading && !auth.redirectTo
  );
  const missing = needsCheck && !owned;
  // Keyed by goal: a link to another goal gets its own fresh read.
  // `failed` keeps the link (with a retry) when that read itself errored.
  const [recheck, setRecheck] = useState<{
    goalId: string;
    failed: boolean;
  } | null>(null);
  const recheckedThis = recheck !== null && recheck.goalId === goalId;
  const { refetch } = wallet;
  useEffect(() => {
    if (!needsCheck || recheckedThis || !goalId) return;
    let live = true;
    void refetch().then(
      (result) => {
        // Only a real result without an error counts as a fresh read; a
        // missing result is indeterminate and keeps the link (with a retry).
        const failed = !result || result.isError === true;
        if (live) setRecheck({ goalId, failed });
      },
      () => {
        if (live) setRecheck({ goalId, failed: true });
      }
    );
    return () => {
      live = false;
    };
  }, [needsCheck, recheckedThis, goalId, refetch]);
  // A goal confirmed gone (settled, cancelled or not on this account) opens
  // the plain wallet with a short note, so an old link does not look broken.
  const gone = missing && recheckedThis && recheck?.failed === false;
  const noted = useRef<string | null>(null);
  useEffect(() => {
    // Once per goal link, even if the effect runs twice (StrictMode).
    if (!gone || !goalId || noted.current === goalId) return;
    noted.current = goalId;
    notifySavings(
      'That savings plan has closed',
      "It's finished or isn't on this account, so here's your wallet.",
      'info'
    );
    // Not tied to any goal (the wallet's next goal must not clear it), and
    // wallet-only, so it never appears inside another goal's sheet.
    const { notice } = useSavingsNoticeStore.getState();
    useSavingsNoticeStore.setState({
      goalId: null,
      notice: notice ? { ...notice, walletOnly: true } : notice,
    });
  }, [gone, goalId]);
  // After sign-in the customer comes back here, so the ownership check runs.
  const back = goalId
    ? `/wallet/savings/goal-actions?goalId=${encodeURIComponent(goalId)}`
    : '/wallet';
  const login = `/auth/login?returnTo=${encodeURIComponent(back)}` as Href;
  // Supersedes a hung read (cancels it) instead of stacking a second one.
  const reread = () => void wallet.refetch({ cancelRefetch: true });
  if (auth.isLoading) return <GoalLinkShell />;
  if (auth.redirectTo) return <Redirect href={login} />;
  if (!goalId) return <Redirect href="/wallet" />;
  // No data and no error means the wallet read has not settled yet (still
  // loading, or held while the signed-in identities catch up after an
  // account switch): wait rather than drop a valid goal link.
  if (!wallet.data && !wallet.isError) {
    return <GoalLinkShell reread={reread} />;
  }
  // A failed wallet read keeps the link: the customer can retry instead of
  // landing on the plain wallet without the goal they opened.
  if (wallet.isError && !wallet.data) {
    return <GoalLinkShell onRetry={() => void wallet.refetch()} />;
  }
  if (needsCheck && !recheckedThis) return <GoalLinkShell reread={reread} />;
  // The fresh read failed: the goal may still be theirs, so keep the link.
  if (needsCheck && recheck?.failed) {
    return <GoalLinkShell onRetry={() => setRecheck(null)} />;
  }
  // A goal that is no longer the customer's (settled, cancelled, someone
  // else's) opens the plain wallet: the sheet would otherwise fall back to a
  // different goal and offer to cancel or complete that one.
  return (
    <>
      <Stack.Screen options={{ title: 'Savings' }} />
      <Redirect
        href={
          (owned
            ? `/wallet?action=savings&savingsGoalId=${encodeURIComponent(goalId)}`
            : '/wallet') as Href
        }
      />
    </>
  );
}
