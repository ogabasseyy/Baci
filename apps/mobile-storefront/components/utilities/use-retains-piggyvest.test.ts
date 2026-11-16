import { renderHook, waitFor } from '@testing-library/react-native';
import { useRetainsPiggyvest } from './use-retains-piggyvest';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

const request = {
  amount: 500,
  phoneNumber: '08031234567',
  type: 'airtime' as const,
  walletAmount: 500,
};

describe('useRetainsPiggyvest', () => {
  it('reports a kept PiggyVest attempt for this exact purchase', async () => {
    const retains = jest.fn(async () => true);
    useVtuWalletPayStore.setState({ retains });
    const hook = renderHook(() => useRetainsPiggyvest(request));
    await waitFor(() => expect(hook.result.current).toBe(true));
    expect(retains).toHaveBeenCalledWith(request);
  });

  it('is false with no purchase yet, and when nothing is kept', async () => {
    const retains = jest.fn(async () => false);
    useVtuWalletPayStore.setState({ retains });
    expect(renderHook(() => useRetainsPiggyvest(null)).result.current).toBe(
      false
    );
    expect(retains).not.toHaveBeenCalled();
    const hook = renderHook(() => useRetainsPiggyvest(request));
    await waitFor(() => expect(retains).toHaveBeenCalled());
    expect(hook.result.current).toBe(false);
  });

  it('counts an unreadable key store as kept, as the submit does', async () => {
    useVtuWalletPayStore.setState({
      retains: async () => {
        throw new Error('storage unreadable');
      },
    });
    const hook = renderHook(() => useRetainsPiggyvest(request));
    await waitFor(() => expect(hook.result.current).toBe(true));
  });
});
