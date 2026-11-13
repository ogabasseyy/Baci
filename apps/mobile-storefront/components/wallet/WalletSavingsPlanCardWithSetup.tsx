import type { ComponentProps } from 'react';
import { useGoalCardSetupState } from './savings/use-goal-card-setup-state';
import { WalletSavingsPlanCard } from './WalletSavingsPlanCard';

type Props = Omit<
  ComponentProps<typeof WalletSavingsPlanCard>,
  'setupState'
> & {
  /** The savings sheet is open and checks the plan itself. */
  pausePolling?: boolean;
};

/** The wallet's plan card, told whether the plan is still being set up. */
export function WalletSavingsPlanCardWithSetup({
  pausePolling = false,
  ...props
}: Props) {
  const setupState = useGoalCardSetupState(props.goal, pausePolling);
  return <WalletSavingsPlanCard {...props} setupState={setupState} />;
}
