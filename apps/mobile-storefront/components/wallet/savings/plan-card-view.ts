import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { planCardFooterLine } from './plan-card-footer-line';
import type { GoalCardSetupState } from './use-goal-card-setup-state';

export type PlanCardView = {
  eyebrow: string;
  heading: string | null;
  actionLabel: string;
  footerLine: string | null;
  /** The saved-of-target amount and progress bar. */
  showProgress: boolean;
  showEndDate: boolean;
};

/**
 * What the wallet's plan card says for a plan. A completed plan whose
 * savings have already left it (nothing left, nothing awaiting the move) is
 * a purchase the customer requested: the card says so calmly instead of
 * showing ₦0 against the target and inviting a first contribution.
 */
export function planCardView({
  goal,
  awaitingSettlement,
  setupState,
}: {
  goal: WalletActiveSavingsGoal;
  awaitingSettlement: boolean;
  setupState: GoalCardSetupState;
}): PlanCardView {
  const purchaseRequested =
    goal.status === 'completed' &&
    !awaitingSettlement &&
    !goal.selection_unresolved &&
    goal.current_amount <= 0;
  const actionLabel = goal.selection_unresolved
    ? 'Choose exact variant'
    : awaitingSettlement
      ? 'Move your savings'
      : goal.status === 'completed'
        ? 'Start another plan'
        : goal.status === 'paused' ||
            goal.source_mode !== 'manual' ||
            setupState !== null
          ? 'View plan'
          : 'Add to savings';
  if (purchaseRequested)
    return {
      eyebrow: 'Purchase requested',
      heading: null,
      actionLabel,
      footerLine: 'Our team will contact you to finish your order',
      showProgress: false,
      showEndDate: false,
    };
  return {
    eyebrow: 'Your next upgrade',
    heading:
      goal.status === 'completed'
        ? 'Plan complete'
        : goal.status === 'paused'
          ? 'Plan paused'
          : null,
    actionLabel,
    footerLine: planCardFooterLine(setupState, goal.current_amount > 0),
    showProgress: true,
    showEndDate: true,
  };
}
