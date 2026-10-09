import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { PiggyvestWalletSetupPanel } from './PiggyvestWalletSetupPanel';

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { create: jest.fn(), read: jest.fn() },
}));

it('explains when a read-only refresh still has no verified account', async () => {
  jest.mocked(piggyvestPrimaryWalletApi.create).mockResolvedValue({
    provisioningStatus: 'pending',
    requiresConsent: false,
    account: null,
  });
  jest.mocked(piggyvestPrimaryWalletApi.read).mockResolvedValue({
    provisioningStatus: 'pending',
    requiresConsent: false,
    account: null,
  });
  render(
    <PiggyvestWalletSetupPanel
      colors={Colors.dark}
      merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
      needsPhone={false}
      onSubmitPhone={async () => ({ success: true })}
      onRefresh={jest.fn()}
      onClose={jest.fn()}
    />
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Refresh PiggyVest account' })
    ).toBeOnTheScreen()
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Refresh PiggyVest account' })
  );
  await waitFor(() =>
    expect(
      screen.getByText(
        'Your account is still being prepared. Check again shortly.'
      )
    ).toBeOnTheScreen()
  );
  expect(screen.queryByLabelText('BVN')).toBeNull();
});

it('keeps the form actionable with input preserved when creation fails', async () => {
  // A rejected creation (profile/ownership/transport) must not strand
  // the user on a pending screen: the form stays mounted with its BVN
  // so the failure can be corrected and resubmitted. Flipping pending
  // before the outcome would unmount the form and wipe its state even
  // if pending were reset in the catch.
  jest
    .mocked(piggyvestPrimaryWalletApi.create)
    .mockRejectedValue(new Error('Unavailable'));
  const onRefresh = jest.fn();
  render(
    <PiggyvestWalletSetupPanel
      colors={Colors.dark}
      merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
      needsPhone={false}
      onSubmitPhone={async () => ({ success: true })}
      onRefresh={onRefresh}
      onClose={jest.fn()}
    />
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() =>
    expect(
      screen.getByText(
        'Wallet setup could not be confirmed. Refresh your account before trying again.'
      )
    ).toBeOnTheScreen()
  );
  expect(screen.getByLabelText('BVN')).toHaveProp('value', '12345678901');
  expect(
    screen.queryByRole('button', { name: 'Refresh PiggyVest account' })
  ).toBeNull();
  expect(onRefresh).not.toHaveBeenCalled();
});
it('refreshes the wallet when creation returns an account', async () => {
  jest.mocked(piggyvestPrimaryWalletApi.create).mockResolvedValue({
    provisioningStatus: 'ready',
    requiresConsent: false,
    account: {
      accountName: 'Test Account',
      accountNumber: '1234567890',
      bankName: 'Test Bank',
      provider: 'piggyvest',
    },
  });
  const onRefresh = jest.fn();
  render(
    <PiggyvestWalletSetupPanel
      colors={Colors.dark}
      merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
      needsPhone={false}
      onSubmitPhone={async () => ({ success: true })}
      onRefresh={onRefresh}
      onClose={jest.fn()}
    />
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
});
