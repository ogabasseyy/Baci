import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { WalletSavingsPlanCardWithSetup } from './WalletSavingsPlanCardWithSetup';

let mockSetupState: string | null = null;
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('./savings/use-goal-card-setup-state', () => ({
  useGoalCardSetupState: () => mockSetupState,
}));

const goal: WalletActiveSavingsGoal = {
  contribution_amount: 1000,
  contribution_frequency: 'daily',
  current_amount: 0,
  id: 'goal-1',
  maturity_date: '2027-03-16',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'Phone',
};

it('with PiggyVest off, shows the usual first-contribution card', () => {
  mockSetupState = null;
  render(
    <WalletSavingsPlanCardWithSetup
      colors={Colors.light}
      goal={goal}
      onOpen={jest.fn()}
    />
  );
  expect(
    screen.getByText('Start with your first contribution')
  ).toBeOnTheScreen();
});

it('passes a plan still being set up on to the card', () => {
  mockSetupState = 'getting_ready';
  render(
    <WalletSavingsPlanCardWithSetup
      colors={Colors.light}
      goal={goal}
      onOpen={jest.fn()}
    />
  );
  expect(screen.getByText('Getting your plan ready')).toBeOnTheScreen();
});
