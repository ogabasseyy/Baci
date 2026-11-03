import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => false,
  isHostedStagingWalletTopUpBlocked: () => false,
}));

const goal = {
  contribution_amount: 500,
  contribution_frequency: 'weekly' as const,
  current_amount: 50000,
  id: 'goal-1',
  maturity_date: '2026-09-30',
  source_mode: 'manual' as const,
  status: 'active' as const,
  target_amount: 100000,
  title: 'iPhone 15 Pro',
};

// Outside the hosted staging preview the modal is production's: the regular
// wallet contribution flow and no plan-funding notes.
describe('server keeps PiggyVest off', () => {
  it('shows the wallet contribution and no plan notes', () => {
    const onFundWallet = jest.fn();
    render(
      <WalletSavingsProgressModal
        addAmount="500"
        colors={Colors.dark}
        goal={goal}
        isAdding={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={onFundWallet}
        visible
        walletBalance={0}
      />
    );
    expect(screen.queryByText('Add from your wallet')).toBeNull();
    expect(screen.queryByText(/still being set up/)).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Continue to payment' })
    );
    expect(onFundWallet).toHaveBeenCalledTimes(1);
  });
});
