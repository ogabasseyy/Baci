import { useState } from 'react';
import { usePinnedSavingsGoal } from './use-pinned-savings-goal';

/**
 * The wallet's savings sheet state: open or not, a contribution in flight,
 * and which goal is shown (pinned while the sheet is open or a contribution
 * is settling; see usePinnedSavingsGoal).
 */
export function useWalletSavingsSheetState(
  routeAction: string | undefined,
  savingsGoalId: string | string[] | undefined
) {
  const [showSavingsProgressModal, setShowSavingsProgressModal] = useState(
    routeAction === 'savings'
  );
  const [isAddingSavingsContribution, setIsAddingSavingsContribution] =
    useState(false);
  const goalPin = usePinnedSavingsGoal(
    showSavingsProgressModal || isAddingSavingsContribution,
    savingsGoalId
  );
  return {
    goalPin,
    isAddingSavingsContribution,
    setIsAddingSavingsContribution,
    setShowSavingsProgressModal,
    showSavingsProgressModal,
  };
}
