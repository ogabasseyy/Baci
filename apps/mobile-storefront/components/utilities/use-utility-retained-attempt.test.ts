import { renderHook, waitFor } from '@testing-library/react-native';
import { useUtilityRetainedAttempt } from './use-utility-retained-attempt';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

const request = {
  amount: 500,
  networkProvider: 'mtn',
  phoneNumber: '08031234567',
  type: 'airtime' as const,
  walletAmount: 500,
};

describe('useUtilityRetainedAttempt', () => {
  it('reads the PiggyVest key store once per purchase', async () => {
    const retains = jest.fn(async () => true);
    useVtuWalletPayStore.setState({ retains });
    const { result, rerender } = renderHook(() =>
      useUtilityRetainedAttempt({ hasRetainedVtuAttempt: () => false }, request)
    );
    await waitFor(() => expect(result.current.retainedPiggyvest).toBe(true));
    rerender({});

    expect(retains).toHaveBeenCalledTimes(1);
  });

  it('counts a failed read as kept, as the submit does', async () => {
    useVtuWalletPayStore.setState({
      retains: async () => {
        throw new Error('key store unavailable');
      },
    });
    const { result } = renderHook(() =>
      useUtilityRetainedAttempt({ hasRetainedVtuAttempt: () => false }, request)
    );
    await waitFor(() => expect(result.current.retainedPiggyvest).toBe(true));
  });
});
