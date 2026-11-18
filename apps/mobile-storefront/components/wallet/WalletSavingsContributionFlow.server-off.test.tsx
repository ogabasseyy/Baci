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

  describe('starting amount and quick picks', () => {
    function renderFlow(
      props: Partial<{
        addAmount: string;
        onAddAmountChange: (value: string) => void;
        remainingAmount: number;
        walletBalance: number;
      }> = {}
    ) {
      const onAddAmountChange = props.onAddAmountChange ?? jest.fn();
      const view = render(
        <WalletSavingsContributionFlow
          addAmount={props.addAmount ?? ''}
          colors={Colors.light}
          isAdding={false}
          isFundPending={false}
          onAddAmountChange={onAddAmountChange}
          onAddSavings={jest.fn()}
          onFundWallet={jest.fn()}
          remainingAmount={props.remainingAmount ?? 250000}
          walletBalance={props.walletBalance ?? 1000}
        />
      );
      return { onAddAmountChange, ...view };
    }

    it('offers only chips within the remaining amount and fills the field on tap', () => {
      const { onAddAmountChange } = renderFlow({
        addAmount: '1000',
        remainingAmount: 6000,
        walletBalance: 1000,
      });
      expect(screen.queryByRole('button', { name: 'Use ₦10,000' })).toBeNull();
      fireEvent.press(screen.getByRole('button', { name: 'Use ₦5,000' }));
      expect(onAddAmountChange).toHaveBeenCalledWith('5000');
      expect(
        screen.getByRole('button', { name: 'Use ₦1,000, all available' })
      ).toHaveAccessibilityState({ selected: true });
    });

    it('shows the hero action instead of Add money for the default amount', () => {
      renderFlow({ addAmount: '1000', walletBalance: 1000 });
      expect(
        screen.getByRole('button', { name: 'Confirm savings top-up' })
      ).toBeOnTheScreen();
      expect(screen.queryByText('Add money')).toBeNull();
    });
  });
});
