import { type Href, Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import GoalLinkLoadError from '@/components/wallet/savings/GoalLinkLoadError';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { useWallet } from '@/hooks/use-wallet';
import { goalIdParamSchema } from '@/schemas/goal-link';

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

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
  const [rechecked, setRechecked] = useState(false);
  const { refetch } = wallet;
  useEffect(() => {
    if (!missing || rechecked) return;
    let live = true;
    void refetch().finally(() => {
      if (live) setRechecked(true);
    });
    return () => {
      live = false;
    };
  }, [missing, rechecked, refetch]);
  // After sign-in the customer comes back here, so the ownership check runs.
  const back = goalId
    ? `/wallet/savings/goal-actions?goalId=${encodeURIComponent(goalId)}`
    : '/wallet';
  const login = `/auth/login?returnTo=${encodeURIComponent(back)}` as Href;
  if (auth.isLoading) return null;
  if (auth.redirectTo) return <Redirect href={login} />;
  if (!goalId) return <Redirect href="/wallet" />;
  // No data and no error means the wallet read has not settled yet (still
  // loading, or held while the signed-in identities catch up after an
  // account switch): wait rather than drop a valid goal link.
  if (!wallet.data && !wallet.isError) return null;
  // A failed wallet read keeps the link: the customer can retry instead of
  // landing on the plain wallet without the goal they opened.
  if (wallet.isError && !wallet.data) {
    return <GoalLinkLoadError onRetry={() => void wallet.refetch()} />;
  }
  if (missing && !rechecked) return null;
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
