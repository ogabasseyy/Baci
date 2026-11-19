import { render, screen, waitFor } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { PiggyvestWalletSetupPanel } from './PiggyvestWalletSetupPanel';

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { create: jest.fn(), read: jest.fn() },
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: { user: { id: string } | null }) => unknown
  ) => selector({ user: { id: 'user-a-id' } }),
}));

// With the server keeping PiggyVest off, the wallet read answers
// PIGGYVEST_NOT_READY: the panel must show nothing beyond its setup form.
it('shows no review or error state when the server keeps PiggyVest off', async () => {
  jest
    .mocked(piggyvestPrimaryWalletApi.read)
    .mockRejectedValue(
      Object.assign(new Error('not ready'), { code: 'PIGGYVEST_NOT_READY' })
    );
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
  await waitFor(() =>
    expect(piggyvestPrimaryWalletApi.read).toHaveBeenCalledTimes(1)
  );
  expect(screen.getByLabelText('BVN')).toBeOnTheScreen();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(piggyvestPrimaryWalletApi.create).not.toHaveBeenCalled();
});
