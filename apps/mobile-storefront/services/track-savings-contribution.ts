import { NativeModules } from 'react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { useAuthStore } from '@/stores/auth-store';

export async function trackSavingsContribution<Result>(
  goal: WalletActiveSavingsGoal,
  submit: () => Promise<Result>,
  refreshGoal?: () => Promise<WalletActiveSavingsGoal | null>
): Promise<Result> {
  const activity = NativeModules.SavingsLiveActivity;
  const owner = useAuthStore.getState?.().user?.id;
  let observedGoal = goal;
  const update = (phase: string) => {
    if (!owner || owner !== useAuthStore.getState?.().user?.id) return;
    try {
      activity?.track?.(
        goal.id,
        goal.title,
        observedGoal.current_amount,
        observedGoal.target_amount,
        phase
      );
    } catch {
      return;
    }
  };
  update('pending');
  try {
    const result = await submit();
    const status =
      typeof result === 'object' && result !== null && 'status' in result
        ? result.status
        : typeof result === 'object' &&
            result !== null &&
            'success' in result &&
            result.success === true
          ? 'confirmed'
          : 'unknown';
    if (status === 'confirmed' && refreshGoal) {
      const refreshed = await refreshGoal().catch(() => null);
      if (refreshed?.id === goal.id) observedGoal = refreshed;
    }
    update(
      status === 'cancelled'
        ? 'cancelled'
        : status === 'confirmed'
          ? 'confirmed'
          : status === 'pending'
            ? 'pending'
            : 'unknown'
    );
    return result;
  } catch (error) {
    update('unknown');
    throw error;
  }
}
