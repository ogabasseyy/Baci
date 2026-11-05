import { Redirect, useLocalSearchParams } from 'expo-router';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { GoalLifecycleScreen } from '@/components/wallet/savings/GoalLifecycleScreen';

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function WalletGoalActionsRoute() {
  const params = useLocalSearchParams<{
    goalId?: string | string[];
    kind?: string | string[];
  }>();
  const goalId = first(params.goalId);
  const kind = first(params.kind);
  if (!goalId || (kind !== 'cancel' && kind !== 'complete'))
    return <Redirect href="/wallet" />;
  return (
    <StorefrontScreenShell edges={['bottom']} themeBackground>
      <GoalLifecycleScreen kind={kind} goalId={goalId} />
    </StorefrontScreenShell>
  );
}
