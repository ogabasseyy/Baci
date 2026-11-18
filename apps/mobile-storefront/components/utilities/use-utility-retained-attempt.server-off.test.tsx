import { renderHook, waitFor } from '@testing-library/react-native';
import {
  isRetainedForPay,
  useUtilityRetainedAttempt,
} from './use-utility-retained-attempt';
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
    await waitFor(() => expect(result.current.lookupPending).toBe(false));
    expect(result.current).toEqual({
      lookupPending: false,
      retainedPiggyvest: false,
      retainedStoreCredit: true,
    });
    expect(isRetainedForPay(result.current)).toBe(true);
  });

  it('reports nothing kept once the lookup answers', async () => {
    const { result } = renderHook(() =>
      useUtilityRetainedAttempt({ hasRetainedVtuAttempt: () => false }, request)
    );
    await waitFor(() => expect(isRetainedForPay(result.current)).toBe(false));
    expect(result.current.retainedPiggyvest).toBe(false);
  });

  it('does not count as short while the lookup has not answered', () => {
    useVtuWalletPayStore.setState({ retains: () => new Promise(() => {}) });
    const { result } = renderHook(() =>
      useUtilityRetainedAttempt({ hasRetainedVtuAttempt: () => false }, request)
    );
    expect(result.current).toEqual({
      lookupPending: true,
      retainedPiggyvest: false,
      retainedStoreCredit: false,
    });
    expect(isRetainedForPay(result.current)).toBe(true);
  });

  it('reports nothing kept without a purchase', () => {
    const { result } = renderHook(() =>
      useUtilityRetainedAttempt({ hasRetainedVtuAttempt: () => true }, null)
    );
    expect(isRetainedForPay(result.current)).toBe(false);
  });
});
