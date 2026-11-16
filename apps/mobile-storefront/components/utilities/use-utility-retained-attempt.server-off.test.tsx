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

// With the server keeping PiggyVest off no PiggyVest attempt is ever kept:
// only the wallet's own retained attempt counts, as in production today.
describe('useUtilityRetainedAttempt with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    useVtuWalletPayStore.setState({ retains: async () => false });
  });

  it('reports a kept wallet attempt', async () => {
    const { result } = renderHook(() =>
      useUtilityRetainedAttempt({ hasRetainedVtuAttempt: () => true }, request)
    );
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('reports nothing kept when the wallet keeps nothing', async () => {
    const hasRetainedVtuAttempt = jest.fn(() => false);
    const { result } = renderHook(() =>
      useUtilityRetainedAttempt({ hasRetainedVtuAttempt }, request)
    );
    await waitFor(() => expect(result.current).toBe(false));
    expect(hasRetainedVtuAttempt).toHaveBeenCalled();
  });

  it('does not count as short while the lookup has not answered', () => {
    useVtuWalletPayStore.setState({ retains: () => new Promise(() => {}) });
    const { result } = renderHook(() =>
      useUtilityRetainedAttempt({ hasRetainedVtuAttempt: () => false }, request)
    );
    expect(result.current).toBe(true);
  });

  it('reports nothing kept without a purchase', () => {
    const { result } = renderHook(() =>
      useUtilityRetainedAttempt({ hasRetainedVtuAttempt: () => true }, null)
    );
    expect(result.current).toBe(false);
  });
});
