import { type Href, Redirect, useLocalSearchParams } from 'expo-router';
import { useRequireAuth } from '@/hooks/use-auth-guard';

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
  const goalId = first(params.goalId);
  const target = goalId
    ? `/wallet?action=savings&savingsGoalId=${encodeURIComponent(goalId)}`
    : '/wallet';
  const login = `/auth/login?returnTo=${encodeURIComponent(target)}` as Href;
  if (auth.isLoading) return null;
  if (auth.redirectTo) return <Redirect href={login} />;
  return <Redirect href={target as Href} />;
}
