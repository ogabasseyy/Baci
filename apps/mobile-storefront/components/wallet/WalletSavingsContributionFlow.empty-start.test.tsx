import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletSavingsContributionFlow } from './WalletSavingsContributionFlow';

jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => false,
  isHostedStagingWalletTopUpBlocked: () => false,
}));

function flow(
  addAmount: string,
  onAddAmountChange: (v: string) => void,
  key?: string
) {
  return (
    <WalletSavingsContributionFlow
      key={key}
      addAmount={addAmount}
      colors={Colors.light}
      isAdding={false}
      isFundPending={false}
      onAddAmountChange={onAddAmountChange}
      onAddSavings={jest.fn()}
      onFundWallet={jest.fn()}
      remainingAmount={250000}
      walletBalance={40055}
    />
  );
}

describe('Add to savings amount starts empty', () => {
  it('bugfix: does not pre-fill the wallet balance when the sheet opens', () => {
    const onAddAmountChange = jest.fn();
    render(flow('', onAddAmountChange));
    expect(onAddAmountChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Confirm savings top-up' })
    ).toBeDisabled();
  });

  it('bugfix: does not pre-fill again after a phone switch resets the form', () => {
    const onAddAmountChange = jest.fn();
    const { rerender } = render(flow('1000', onAddAmountChange, 'phone-a'));
    rerender(flow('', onAddAmountChange, 'phone-b'));
    expect(onAddAmountChange).not.toHaveBeenCalled();
  });

  it('still fills the amount when the customer taps Max', () => {
    const onAddAmountChange = jest.fn();
    render(flow('', onAddAmountChange));
    fireEvent.press(
      screen.getByRole('button', { name: 'Use ₦40,055, all available' })
    );
    expect(onAddAmountChange).toHaveBeenCalledWith('40055');
  });
});
