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

it('keeps an uncertain creation pending and offers read-only refresh rather than another creation', async () => {
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
      screen.getByRole('button', { name: 'Refresh PiggyVest account' })
    ).toBeOnTheScreen()
  );
  expect(screen.queryByLabelText('BVN')).toBeNull();
  expect(onRefresh).not.toHaveBeenCalled();
});
