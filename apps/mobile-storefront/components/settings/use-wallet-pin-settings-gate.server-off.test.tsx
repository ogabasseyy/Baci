import { renderHook, waitFor } from '@testing-library/react-native';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { fetchWalletPinStatus } from '@/lib/wallet-pin-api';
import { useWalletPinSettingsGate } from './use-wallet-pin-settings-gate';

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn() },
}));
jest.mock('@/lib/wallet-pin-api', () => ({ fetchWalletPinStatus: jest.fn() }));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1' }, merchantId: 'merchant-1' }),
}));

describe('wallet PIN gate when the server keeps PiggyVest off', () => {
  it('is off for a pending wallet', async () => {
    (piggyvestPrimaryWalletApi.read as jest.Mock).mockResolvedValue({
      provisioningStatus: 'pending',
      account: null,
    });
    (fetchWalletPinStatus as jest.Mock).mockResolvedValue({
      primary: false,
      hasPin: false,
      resetRequired: false,
      available: false,
    });
    const { result } = renderHook(() => useWalletPinSettingsGate());
    await waitFor(() => expect(result.current.state).toBe('off'));
    expect(result.current.status).toBeNull();
  });
});
