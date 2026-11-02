import { fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import Colors, { BRAND, palette } from '@/constants/Colors';
import { WalletSavingsContributionFlow } from './WalletSavingsContributionFlow';

jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => false,
  isHostedStagingWalletTopUpBlocked: () => true,
}));

const props = {
  addAmount: '10000',
  colors: Colors.dark,
  isAdding: false,
  isFundPending: false,
  onAddAmountChange: jest.fn(),
  onAddSavings: jest.fn(),
  onFundWallet: jest.fn(),
  remainingAmount: 249900,
  walletBalance: 0,
  usesWalletBankTransfer: true,
};

it('opens primary wallet bank details in hosted staging with a zero spendable balance', () => {
  const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss');
  props.onFundWallet.mockImplementationOnce(() => {
    expect(dismissKeyboard).toHaveBeenCalled();
  });
  render(<WalletSavingsContributionFlow {...props} />);

  expect(screen.getByText('Available in wallet: ₦0')).toBeOnTheScreen();
  expect(screen.queryByText(/Wallet top-ups are disabled/)).toBeNull();
  expect(
    screen.getByText(/Add money to your wallet, then move it/)
  ).toBeOnTheScreen();
  const button = screen.getByRole('button', {
    name: 'Open wallet bank transfer details',
  });
  expect(button).toBeEnabled();
  expect(button).toHaveStyle({ backgroundColor: BRAND.primary });
  expect(screen.getByText('Add money to wallet')).toHaveStyle({
    color: palette.white,
  });
  fireEvent.press(button);
  expect(props.onFundWallet).toHaveBeenCalledTimes(1);
  expect(props.onAddSavings).not.toHaveBeenCalled();
});

it('offers a savings transfer once the primary wallet covers the contribution', () => {
  render(<WalletSavingsContributionFlow {...props} walletBalance={10000} />);
  expect(
    screen.getByRole('button', { name: 'Confirm savings top-up' })
  ).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Open wallet bank transfer details' })
  ).toBeNull();
});
