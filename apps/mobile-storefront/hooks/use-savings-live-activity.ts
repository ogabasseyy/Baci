import { useEffect, useRef } from 'react';
import { NativeModules } from 'react-native';
import { isSavingsActivityOwnerCurrent } from '../services/savings-activity-lifecycle';
import type { WalletActiveSavingsGoal } from './wallet-query';

type SavingsActivityModule = {
  sync: (goalId: string, title: string, saved: number, target: number) => void;
  clear: () => void;
};

export function useSavingsLiveActivity(
  goal: WalletActiveSavingsGoal | null | undefined,
  userId: string | null
) {
  const previousUserId = useRef<string | null | undefined>(undefined);
  const lastSyncedGoalId = useRef<string | null>(null);
  const goalIsUnknown = goal === undefined;
  const goalIsAbsent = goal === null;
  const goalId = goal?.id;
  const goalTitle = goal?.title;
  const currentAmount = goal?.current_amount;
  const targetAmount = goal?.target_amount;
  useEffect(() => {
    const module = NativeModules.SavingsLiveActivity as
      | SavingsActivityModule
      | undefined;
    if (!module) return;
    // Auth transitions clear centrally. A queued effect for a prior owner must
    // not clear the new owner's activity or reset this hook's bookkeeping.
    if (!userId || !isSavingsActivityOwnerCurrent(userId)) return;
    if (previousUserId.current !== userId) {
      previousUserId.current = userId;
      lastSyncedGoalId.current = null;
    }
    if (goalIsUnknown) return;
    if (
      goalIsAbsent ||
      goalId === undefined ||
      goalTitle === undefined ||
      !Number.isFinite(currentAmount) ||
      !Number.isFinite(targetAmount) ||
      targetAmount === undefined ||
      targetAmount <= 0 ||
      currentAmount === undefined
    ) {
      if (lastSyncedGoalId.current !== null) {
        module.clear();
        lastSyncedGoalId.current = null;
      }
      return;
    }
    module.sync(goalId, goalTitle, currentAmount, targetAmount);
    lastSyncedGoalId.current = goalId;
  }, [
    goalIsUnknown,
    goalIsAbsent,
    goalId,
    goalTitle,
    currentAmount,
    targetAmount,
    userId,
  ]);
}
