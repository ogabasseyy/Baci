import { Redirect, useLocalSearchParams } from 'expo-router';

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/**
 * Cancel and Complete now happen inside the savings sheet on the wallet. Old
 * links to the full-page screen open that sheet for the same goal instead.
 */
export default function WalletGoalActionsRoute() {
  const params = useLocalSearchParams<{ goalId?: string | string[] }>();
  const goalId = first(params.goalId);
  return (
    <Redirect
      href={
        goalId
          ? `/wallet?action=savings&savingsGoalId=${encodeURIComponent(goalId)}`
          : '/wallet'
      }
    />
  );
}
