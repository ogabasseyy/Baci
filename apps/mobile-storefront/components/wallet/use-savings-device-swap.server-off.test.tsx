import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { Product } from '@/types/product';
import { useSavingsDeviceSwap } from './use-savings-device-swap';

jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({
    products: [],
    isLoading: false,
    resolveProduct: jest.fn(),
  }),
}));
jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

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

  it('alerts and stays open when the change throws', async () => {
    const change = jest.fn().mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useSavingsDeviceSwap(change));
    act(() => result.current.setShowSavingsDeviceSwap(true));
    await act(async () => {
      await result.current.handleSelectSavingsDevice(product);
    });
    expect(Alert.alert).toHaveBeenCalled();
    expect(result.current.showSavingsDeviceSwap).toBe(true);
  });
});
