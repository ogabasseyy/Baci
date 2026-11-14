import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { WalletSavingsPlanCard } from './WalletSavingsPlanCard';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

const goal: WalletActiveSavingsGoal = {
  contribution_amount: 10000,
  contribution_frequency: 'weekly',
  current_amount: 100000,
  id: 'goal-1',
  maturity_date: '2026-10-30',
  source_mode: 'manual',
  status: 'completed',
  target_amount: 100000,
  title: 'iPhone 15 Pro',
};

// With the server keeping PiggyVest off nothing marks the goal as awaiting
// settlement, so a completed plan keeps the legacy label.
describe('server keeps PiggyVest off', () => {
  it('keeps the legacy start-another-plan action', () => {
    render(
      <WalletSavingsPlanCard
        colors={Colors.light}
        goal={goal}
        onOpen={jest.fn()}
      />
    );
    expect(
      screen.getByRole('button', {
        name: 'Start another plan for iPhone 15 Pro',
      })
    ).toBeOnTheScreen();
  });
});
