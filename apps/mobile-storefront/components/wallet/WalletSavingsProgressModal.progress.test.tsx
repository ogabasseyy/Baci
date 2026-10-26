import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Colors, { BRAND } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('./WalletSavingsContributionSection', () => ({
  WalletSavingsContributionSection: () => null,
}));

const goal: WalletActiveSavingsGoal = {
  contribution_amount: 100,
  contribution_frequency: 'monthly',
  current_amount: 100,
  id: 'progress-regression',
  maturity_date: '2027-10-12',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'A very long savings device name with storage and colour',
};

function renderProgress(currentAmount: number) {
  return render(
    <WalletSavingsProgressModal
      addAmount=""
      colors={Colors.dark}
      goal={{ ...goal, current_amount: currentAmount }}
      isAdding={false}
      onAddAmountChange={jest.fn()}
      onAddSavings={jest.fn()}
      onChangeDevice={jest.fn()}
      onClose={jest.fn()}
      onFundWallet={jest.fn()}
      visible
      walletBalance={0}
      usesWalletBankTransfer
    />
  );
}

describe('bugfix: fractional savings progress in the modal', () => {
  it.each([
    [0, 0, '0%'],
    [100, 0.04, '<1%'],
    [2000, 0.8, '<1%'],
    [250000, 100, '100%'],
    [300000, 100, '100%'],
  ])('displays %s saved accurately in its label, accessibility value and fill', (amount, percent, label) => {
    renderProgress(amount);

    expect(screen.getByText(label)).toBeOnTheScreen();
    const progress = screen.getByLabelText('Savings plan progress details');
    expect(progress).toHaveAccessibilityValue({ now: percent, text: label });
    expect(StyleSheet.flatten(progress.props.children.props.style)).toEqual(
      expect.objectContaining({
        width: `${percent}%`,
        backgroundColor: BRAND.primary,
      })
    );
  });

  it('keeps a long savings device name on one line with a trailing ellipsis', () => {
    renderProgress(100);

    expect(screen.getByText(goal.title)).toHaveProp('numberOfLines', 1);
    expect(screen.getByText(goal.title)).toHaveProp('ellipsizeMode', 'tail');
  });
});
