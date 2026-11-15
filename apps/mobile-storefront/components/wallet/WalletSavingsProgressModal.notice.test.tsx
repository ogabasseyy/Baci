import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import Colors from '@/constants/Colors';
import { useSavingsNoticeStore } from './savings/savings-notice-store';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';

jest.mock('./WalletSavingsFundingSection', () => ({
  WalletSavingsFundingSection: () => null,
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => false,
  isHostedStagingWalletTopUpBlocked: () => false,
}));

const goal = {
  contribution_amount: 1000,
  contribution_frequency: 'weekly' as const,
  current_amount: 40000,
  id: 'goal-1',
  maturity_date: '2999-12-01',
  source_mode: 'manual' as const,
  status: 'active' as const,
  target_amount: 250000,
  title: 'Phone',
};

describe('savings sheet notice', () => {
  beforeEach(() => {
    useSavingsNoticeStore.setState({
      goalId: goal.id,
      notice: { scope: ':', title: 'Savings updated', tone: 'success' },
    });
  });

  it('bugfix: drops the "Savings updated" notice once the customer taps Change to move on to Change phone', () => {
    const onChangeDevice = jest.fn();
    const view = render(
      <WalletSavingsProgressModal
        addAmount="200"
        colors={Colors.light}
        goal={goal}
        isAdding={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={onChangeDevice}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={0}
      />
    );
    expect(screen.getByText('Savings updated')).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText('Change savings device'));
    expect(onChangeDevice).toHaveBeenCalledTimes(1);
    // The parent now renders the Change phone step in the same sheet.
    view.rerender(
      <WalletSavingsProgressModal
        addAmount="200"
        colors={Colors.light}
        goal={goal}
        isAdding={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={onChangeDevice}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        phoneSwapStep={<Text>Change phone</Text>}
        visible
        walletBalance={0}
      />
    );
    expect(screen.queryByText('Savings updated')).toBeNull();
  });
});
