import { act, renderHook } from '@testing-library/react-native';
import type { Product } from '@/types/product';
import { notifySavings } from './savings/savings-notice';
import { useSavingsDeviceSwap } from './use-savings-device-swap';

jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({
    products: [],
    isLoading: false,
    resolveProduct: jest.fn(),
  }),
}));
jest.mock('./savings/savings-notice', () => {
  const notifySavings = jest.fn();
  return { notifySavings, savingsNotifier: () => notifySavings };
});

const product = { id: 'p' } as Product;

describe('server keeps PiggyVest off: useSavingsDeviceSwap', () => {
  it('closes and clears the search after a successful change', async () => {
    const change = jest.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useSavingsDeviceSwap(change));
    act(() => {
      result.current.setShowSavingsDeviceSwap(true);
      result.current.setSavingsDeviceSearch('iphone');
    });
    await act(async () => {
      await result.current.handleSelectSavingsDevice(product, 'v');
    });
    expect(change).toHaveBeenCalledWith(product, 'v');
    expect(result.current.showSavingsDeviceSwap).toBe(false);
    expect(result.current.savingsDeviceSearch).toBe('');
    expect(result.current.isChangingSavingsDevice).toBe(false);
  });

  it('shows a warning notice and stays open when the change throws', async () => {
    const change = jest.fn().mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useSavingsDeviceSwap(change));
    act(() => result.current.setShowSavingsDeviceSwap(true));
    await act(async () => {
      await result.current.handleSelectSavingsDevice(product);
    });
    expect(notifySavings).toHaveBeenCalledWith(
      'Unable to change device',
      'Please try again in a moment.',
      'warning'
    );
    expect(result.current.showSavingsDeviceSwap).toBe(true);
  });
});
