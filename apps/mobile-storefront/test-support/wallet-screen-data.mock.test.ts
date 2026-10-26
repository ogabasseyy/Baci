import { renderHook } from '@testing-library/react-native';
import { useWallet } from '@/hooks/use-wallet';
import { useWalletScreenData } from './wallet-screen-data.mock';

jest.mock('@/hooks/use-wallet', () => ({ useWallet: jest.fn() }));

it('preserves the screen’s query contract without making isolated action tests start network queries', () => {
  const refetch = jest.fn();
  const getWalletBalance = jest.fn(() => 0);
  const getWalletError = jest.fn(() => null);
  const isFetchingNow = jest.fn(() => false);
  const isWalletSettled = jest.fn(() => false);
  jest.mocked(useWallet).mockReturnValue({
    data: undefined,
    balancePreview: undefined,
    error: null,
    fetchStatus: 'idle',
    getWalletBalance,
    getWalletError,
    isError: false,
    isFetchingNow,
    isLoading: false,
    isRefetching: false,
    isWalletSettled,
    refetch,
  });
  const { result } = renderHook(() => useWalletScreenData());
  expect(result.current.refetch).toBe(refetch);
  expect(result.current.getWalletBalance()).toBe(0);
  expect(result.current.getWalletError()).toBeNull();
  expect(result.current.isFetchingNow()).toBe(false);
  expect(result.current.isWalletSettled()).toBe(false);
  expect(useWallet).toHaveBeenCalledWith({
    cachePolicy: 'display',
    navigationRefresh: 'numbers',
    progressive: true,
  });
});
