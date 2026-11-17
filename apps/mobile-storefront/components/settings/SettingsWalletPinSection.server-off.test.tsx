import { act, render, screen } from '@testing-library/react-native';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { fetchWalletPinStatus } from '@/lib/wallet-pin-api';
import { SettingsWalletPinSection } from './SettingsWalletPinSection';

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn() },
}));
jest.mock('@/lib/wallet-pin-api', () => ({ fetchWalletPinStatus: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()) }),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1' }, merchantId: 'merchant-1' }),
}));

describe('Settings Wallet PIN row when the server keeps PiggyVest off', () => {
  it.each([
    [
      'not ready code',
      () =>
        Promise.reject(
          Object.assign(new Error('x'), { code: 'PIGGYVEST_NOT_READY' })
        ),
      { primary: true, hasPin: true, resetRequired: false, available: true },
    ],
    [
      'pending snapshot',
      () => Promise.resolve({ provisioningStatus: 'pending', account: null }),
      { primary: true, hasPin: true, resetRequired: false, available: true },
    ],
    [
      'primary false',
      () =>
        Promise.resolve({ provisioningStatus: 'ready', account: { id: 'a' } }),
      { primary: false, hasPin: false, resetRequired: false, available: false },
    ],
  ])('shows no row for %s', async (_label, read, pinStatus) => {
    (piggyvestPrimaryWalletApi.read as jest.Mock).mockImplementation(read);
    (fetchWalletPinStatus as jest.Mock).mockResolvedValue(pinStatus);
    render(<SettingsWalletPinSection />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByText('Wallet PIN')).toBeNull();
    expect(screen.toJSON()).toBeNull();
  });
});
