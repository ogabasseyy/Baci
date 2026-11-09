import { beforeEach } from '@jest/globals';
import type { User } from '@supabase/supabase-js';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { useAuthStore } from '@/stores/auth-store';
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
const authUser: User = {
  id: 'customer-a',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00.000Z',
};

// Outside the hosted staging preview the modal is production's: the regular
// wallet contribution flow and no plan-funding notes.
describe('server keeps PiggyVest off', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: authUser, merchantId: 'merchant-a' });
  });
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

  it('shows no cancel or complete button for a signed-out customer', () => {
    useAuthStore.setState({ user: null });
    render(
      <WalletSavingsProgressModal
        addAmount=""
        colors={Colors.dark}
        goal={{ ...goal, status: 'completed' as never }}
        isAdding={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={0}
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Cancel savings goal' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Complete savings goal' })
    ).toBeNull();
  });

  it('updates progress without inferring payment success from a balance change', () => {
    const view = (current: number, isAdding: boolean) => (
      <WalletSavingsProgressModal
        addAmount="500"
        colors={Colors.dark}
        goal={{ ...goal, current_amount: current }}
        isAdding={isAdding}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={5000}
      />
    );
    const { rerender } = render(view(50000, false));
    expect(screen.queryByText(/added\. You're/)).toBeNull();
    rerender(view(50000, true));
    rerender(view(60000, true));
    rerender(view(60000, false));
    expect(screen.queryByText(/Nice!.*added/)).toBeNull();
    expect(screen.getByText('60%')).toBeOnTheScreen();
  });

  it('keeps the device change secondary to the saving action', () => {
    render(
      <WalletSavingsProgressModal
        addAmount="500"
        colors={Colors.light}
        goal={goal}
        isAdding={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={5000}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Confirm savings top-up' })
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Change savings device' })
    ).toBeOnTheScreen();
  });
});
