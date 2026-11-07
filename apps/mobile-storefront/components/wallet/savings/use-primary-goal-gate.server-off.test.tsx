import { act, renderHook, waitFor } from '@testing-library/react-native';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';
import {
  SERVER_OFF_MERCHANT_ID,
  serverOffError,
} from '@/test-support/piggyvest-server-off.test-support';
import { usePrimaryGoalGate } from './use-primary-goal-gate';

jest.mock('@/lib/piggyvest-primary-wallet');
jest.mock('@/lib/is-piggyvest-primary-merchant');

describe('server keeps PiggyVest off', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(true);
    act(() => {
      useAuthStore.setState({
        user: { id: 'user-a' } as never,
        merchantId: SERVER_OFF_MERCHANT_ID,
      });
    });
  });

  it('is off when the read says PIGGYVEST_NOT_READY', async () => {
    jest
      .mocked(piggyvestPrimaryWalletApi.read)
      .mockRejectedValue(serverOffError());
    const { result } = renderHook(() => usePrimaryGoalGate());
    await waitFor(() => expect(result.current).toBe('off'));
  });

  it('is off, with no read at all, for a merchant outside the pilot', () => {
    jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(false);
    const { result } = renderHook(() => usePrimaryGoalGate());
    expect(result.current).toBe('off');
    expect(piggyvestPrimaryWalletApi.read).not.toHaveBeenCalled();
  });

  it('is off for a pending snapshot', async () => {
    jest.mocked(piggyvestPrimaryWalletApi.read).mockResolvedValue({
      account: null,
      requiresConsent: true,
      provisioningStatus: 'pending',
    });
    const { result } = renderHook(() => usePrimaryGoalGate());
    await waitFor(() => expect(result.current).toBe('off'));
  });
});
