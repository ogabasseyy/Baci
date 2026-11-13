import { type Href, Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import GoalLinkLoadError from '@/components/wallet/savings/GoalLinkLoadError';
import { notifySavings } from '@/components/wallet/savings/savings-notice';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { useWallet } from '@/hooks/use-wallet';
import { goalIdParamSchema } from '@/schemas/goal-link';

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/** How long the link waits on a silent read before offering a retry. */
const SLOW_MS = 15_000;

/**
 * What the link shows before it redirects: a spinner, or a retry notice when
 * a read failed (Try again re-reads) or has said nothing for SLOW_MS (Keep
 * waiting restarts the wait; the wallet read keeps going on its own).
 */
function GoalLinkShell({ onRetry }: { onRetry?: () => void }) {
  const [slow, setSlow] = useState(false);
  // Each quiet spell gets its own timer; Try again starts a new one.
  useEffect(() => {
    if (onRetry || slow) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [onRetry, slow]);
  const retry = onRetry ?? (slow ? () => setSlow(false) : undefined);
  return (
    <StorefrontScreenShell themeBackground>
      {retry ? (
        <GoalLinkLoadError onRetry={retry} slow={!onRetry} />
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
  const owned = goals.some((goal) => goal.id === goalId);
  // A goal missing from the cached wallet (created or changed elsewhere since
  // the last read) gets one fresh read before the link gives up on it.
  const missing = Boolean(goalId && wallet.data && !owned);
  // Keyed by goal: a link to another missing goal gets its own fresh read.
  // `failed` keeps the link (with a retry) when that read itself errored.
  const [recheck, setRecheck] = useState<{
    goalId: string;
    failed: boolean;
  } | null>(null);
  const recheckedThis = recheck !== null && recheck.goalId === goalId;
  const { refetch } = wallet;
  useEffect(() => {
    if (!missing || recheckedThis || !goalId) return;
    let live = true;
    void refetch().then(
      (result) => {
        if (live) setRecheck({ goalId, failed: Boolean(result?.isError) });
      },
      () => {
        if (live) setRecheck({ goalId, failed: true });
      }
    );
    return () => {
      live = false;
    };
  }, [missing, recheckedThis, goalId, refetch]);
  // A goal confirmed gone (settled, cancelled or not on this account) opens
  // the plain wallet with a short note, so an old link does not look broken.
  const gone = missing && recheckedThis && recheck?.failed === false;
  useEffect(() => {
    if (!gone) return;
    notifySavings(
      'That savings plan has closed',
      "It's finished or isn't on this account, so here's your wallet.",
      'info'
    );
  }, [gone]);
  // After sign-in the customer comes back here, so the ownership check runs.
  const back = goalId
    ? `/wallet/savings/goal-actions?goalId=${encodeURIComponent(goalId)}`
    : '/wallet';
  const login = `/auth/login?returnTo=${encodeURIComponent(back)}` as Href;
  if (auth.isLoading) return <GoalLinkShell />;
  if (auth.redirectTo) return <Redirect href={login} />;
  if (!goalId) return <Redirect href="/wallet" />;
  // No data and no error means the wallet read has not settled yet (still
  // loading, or held while the signed-in identities catch up after an
  // account switch): wait rather than drop a valid goal link.
  if (!wallet.data && !wallet.isError) return <GoalLinkShell />;
  // A failed wallet read keeps the link: the customer can retry instead of
  // landing on the plain wallet without the goal they opened.
  if (wallet.isError && !wallet.data) {
    return <GoalLinkShell onRetry={() => void wallet.refetch()} />;
  }
  if (missing && !recheckedThis) return <GoalLinkShell />;
  // The fresh read failed: the goal may still be theirs, so keep the link.
  if (missing && recheck?.failed) {
    return <GoalLinkShell onRetry={() => setRecheck(null)} />;
  }
  // A goal that is no longer the customer's (settled, cancelled, someone
  // else's) opens the plain wallet: the sheet would otherwise fall back to a
  // different goal and offer to cancel or complete that one.
  return (
    <Redirect
      href={
        (owned
          ? `/wallet?action=savings&savingsGoalId=${encodeURIComponent(goalId)}`
          : '/wallet') as Href
      }
    />
  );
}
