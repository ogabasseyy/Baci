import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletSavingsContributionFlow } from './WalletSavingsContributionFlow';

jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => false,
  isHostedStagingWalletTopUpBlocked: () => false,
}));

// Outside the staging preview the flow is production's: card payment copy.
describe('server keeps PiggyVest off', () => {
  it('sends an unfunded wallet to the regular payment', () => {
    const onFundWallet = jest.fn();
    render(
      <WalletSavingsContributionFlow
        addAmount="500"
        colors={Colors.dark}
        isAdding={false}
        isFundPending={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onFundWallet={onFundWallet}
        remainingAmount={1000}
        walletBalance={0}
      />
    );
    expect(screen.queryByText(/staging preview/)).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Fund wallet for savings' })
    ).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Continue to payment' })
    );
    expect(onFundWallet).toHaveBeenCalledTimes(1);
  });
});
