import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { WalletHeroSection } from './WalletHeroSection';

const base = {
  earningsBalance: 0,
  loyaltyPoints: 0,
  onOpenFundPanel: jest.fn(),
  onOpenRedeemPanel: jest.fn(),
  savingsBalance: 0,
  totalBalance: 0,
};

it('centers the only setup action in the account space and moves Add Money back into the header once ready', () => {
  const { rerender } = render(
    <WalletHeroSection {...base} walletSetupState="not_started" />
  );
  const header = screen.getByTestId('wallet-balance-header');
  expect(
    within(header).queryByRole('button', { name: 'Create account number' })
  ).toBeNull();
  const slot = screen.getByTestId('wallet-setup-account-space');
  expect(slot).toHaveStyle({
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
  });
  fireEvent.press(
    within(slot).getByRole('button', { name: 'Create account number' })
  );
  expect(base.onOpenFundPanel).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Set up your bank transfer account')).toBeNull();

  rerender(
    <WalletHeroSection
      {...base}
      walletSetupState="ready"
      fundingAccount={{
        accountNumber: '1234567890',
        accountName: 'SANDBOX',
        bankName: 'TEST',
        provider: 'piggyvest',
      }}
    />
  );
  expect(
    within(screen.getByTestId('wallet-balance-header')).getByRole('button', {
      name: 'Add money',
    })
  ).toBeTruthy();
  expect(screen.queryByTestId('wallet-setup-account-space')).toBeNull();
});

it('keeps the processing action in the same account space', () => {
  render(<WalletHeroSection {...base} walletSetupState="processing" />);
  expect(
    within(screen.getByTestId('wallet-setup-account-space')).getByRole(
      'button',
      { name: 'View progress' }
    )
  ).toBeTruthy();
  expect(screen.queryByText('Your account is on its way')).toBeNull();
});

it('retains the centered primary layout and blocks setup while capability is unknown', () => {
  const onOpenFundPanel = jest.fn();
  const { rerender } = render(
    <WalletHeroSection
      {...base}
      onOpenFundPanel={onOpenFundPanel}
      walletSetupState="checking"
      primaryCapabilityPending
    />
  );
  const slot = screen.getByTestId('wallet-setup-account-space');
  const action = within(slot).getByRole('button', {
    name: 'Checking availability…',
  });
  expect(action).toBeDisabled();
  fireEvent.press(action);
  expect(onOpenFundPanel).not.toHaveBeenCalled();
  expect(
    within(screen.getByTestId('wallet-balance-header')).queryByText(
      'Total Balance · NGN'
    )
  ).toBeNull();
  rerender(
    <WalletHeroSection
      {...base}
      onOpenFundPanel={onOpenFundPanel}
      walletSetupState="not_started"
    />
  );
  expect(screen.getByTestId('wallet-setup-account-space')).toHaveStyle({
    top: 0,
    bottom: 0,
  });
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  expect(onOpenFundPanel).toHaveBeenCalledTimes(1);
});
