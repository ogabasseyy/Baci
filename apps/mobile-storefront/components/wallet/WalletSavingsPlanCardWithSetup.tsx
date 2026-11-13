import type { ComponentProps } from 'react';
import { useGoalCardSetupState } from './savings/use-goal-card-setup-state';
import { WalletSavingsPlanCard } from './WalletSavingsPlanCard';

type Props = Omit<ComponentProps<typeof WalletSavingsPlanCard>, 'setupState'>;

/** The wallet's plan card, told whether the plan is still being set up. */
export function WalletSavingsPlanCardWithSetup(props: Props) {
  const setupState = useGoalCardSetupState(props.goal);
  return <WalletSavingsPlanCard {...props} setupState={setupState} />;
}
