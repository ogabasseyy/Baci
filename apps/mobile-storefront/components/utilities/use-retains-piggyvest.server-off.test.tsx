import { renderHook, waitFor } from '@testing-library/react-native';
import { useRetainsPiggyvest } from './use-retains-piggyvest';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

// With the server keeping PiggyVest off no host ever installs a key store:
// the default answers nothing kept, so no form changes what it shows.
describe('useRetainsPiggyvest with the server keeping PiggyVest off', () => {
  it('reports nothing kept with the default store', async () => {
    useVtuWalletPayStore.setState({ retains: async () => false });
    const hook = renderHook(() =>
      useRetainsPiggyvest({
        amount: 500,
        phoneNumber: '08031234567',
        type: 'airtime',
        walletAmount: 500,
      })
    );
    await waitFor(() => expect(hook.result.current).toBe(false));
  });
});
