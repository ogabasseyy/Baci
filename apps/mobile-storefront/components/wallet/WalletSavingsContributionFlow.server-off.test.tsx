import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPrimaryContext } from './WalletPrimaryContext';
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
      screen.queryByRole('button', { name: 'Add money for savings' })
    ).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Continue to payment' })
    );
    expect(onFundWallet).toHaveBeenCalledTimes(1);
  });

  it('keeps the card payment when an explicit false verdict is provided', () => {
    render(
      <WalletPrimaryContext.Provider value={false}>
        <WalletSavingsContributionFlow
          addAmount="500"
          colors={Colors.dark}
          isAdding={false}
          isFundPending={false}
          onAddAmountChange={jest.fn()}
          onAddSavings={jest.fn()}
          onFundWallet={jest.fn()}
          remainingAmount={1000}
          walletBalance={0}
        />
      </WalletPrimaryContext.Provider>
    );
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeOnTheScreen();
    expect(screen.queryByText('Add money')).toBeNull();
  });
});
