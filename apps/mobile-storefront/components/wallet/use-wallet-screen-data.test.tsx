import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useWalletScreenData } from './use-wallet-screen-data';

let mockFocused = true;
let mockMerchantId = 'merchant-1';
let mockCustomerUserId = 'user-1';
let mockFetchStatus = 'idle';
let mockHasSnapshot = true;
let mockNumberStatus = 'idle';
const mockRefetch = jest.fn().mockResolvedValue({});
const mockRefreshNumbers = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: mockHasSnapshot ? { wallet: { total_balance: 200 } } : undefined,
    isError: false,
    isRefetching: false,
    fetchStatus: mockFetchStatus,
    refetch: mockRefetch,
  }),
}));
jest.mock('@/hooks/use-wallet-number-refresh', () => ({
  useWalletNumberRefresh: () => ({
    mutateAsync: mockRefreshNumbers,
    isPaused: mockNumberStatus === 'paused',
    isPending: mockNumberStatus === 'pending',
    isError: mockNumberStatus === 'error',
  }),
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: 'merchant-1' } }));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      customer: { id: 'customer-1', user_id: mockCustomerUserId },
      merchantId: mockMerchantId,
      user: { id: 'user-1' },
    }),
}));

let onAppState!: (state: AppStateStatus) => void;
const remove = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  mockMerchantId = 'merchant-1';
  mockCustomerUserId = 'user-1';
  mockFetchStatus = 'idle';
  mockHasSnapshot = true;
  mockNumberStatus = 'idle';
  mockRefreshNumbers.mockResolvedValue(undefined);
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      onAppState = callback;
      return { remove };
    });
});
afterEach(() => jest.restoreAllMocks());

it('passes full-read failures through to the refresh owner instead of claiming success', async () => {
  const { unmount } = renderHook(() => useWalletScreenData());
  const request = mockRefreshNumbers.mock.calls[0][0];

  await request.refetchFull();

  expect(mockRefetch).toHaveBeenCalledWith({
    cancelRefetch: false,
    throwOnError: true,
  });
  unmount();
});

it('refreshes missed transactions alongside numbers on cached visits and tab revisits', async () => {
  const { rerender, unmount } = renderHook(() => useWalletScreenData());
  await act(async () => {});
  expect(mockRefreshNumbers).toHaveBeenCalledTimes(1);
  mockFocused = false;
  rerender({});
  mockFocused = true;
  rerender({});
  expect(mockRefreshNumbers).toHaveBeenCalledTimes(2);
  for (const [request] of mockRefreshNumbers.mock.calls)
    expect(request.includeTransactions).toBe(true);
  expect(mockRefetch).not.toHaveBeenCalled();
  unmount();
});

it('pins a merchant switch to the target scope without refreshing the whole wallet', async () => {
  const { rerender, unmount } = renderHook(() => useWalletScreenData());
  await act(async () => {});
  mockMerchantId = 'merchant-2';
  rerender({});
  expect(mockRefreshNumbers).toHaveBeenLastCalledWith(
    expect.objectContaining({ merchantId: 'merchant-2' })
  );
  expect(mockRefetch).not.toHaveBeenCalled();
  unmount();
});

it('defers hidden tab reads until focus and leaves cold loading to the full query', () => {
  mockFocused = false;
  const { rerender, unmount } = renderHook(() => useWalletScreenData());
  expect(mockRefreshNumbers).not.toHaveBeenCalled();
  mockFocused = true;
  rerender({});
  expect(mockRefreshNumbers).toHaveBeenCalledTimes(1);
  unmount();
  mockHasSnapshot = false;
  const cold = renderHook(() => useWalletScreenData());
  expect(mockRefreshNumbers).toHaveBeenCalledTimes(1);
  cold.unmount();
});

it('coalesces a resume during a pending numeric read into one trailing refresh', async () => {
  let complete!: () => void;
  mockRefreshNumbers.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      complete = resolve;
    })
  );
  const { unmount } = renderHook(() => useWalletScreenData());
  act(() => {
    onAppState('background');
    onAppState('active');
    onAppState('active');
  });
  expect(mockRefreshNumbers).toHaveBeenCalledTimes(1);
  await act(async () => complete());
  await waitFor(() => expect(mockRefreshNumbers).toHaveBeenCalledTimes(2));
  unmount();
});

it('fences an old numeric read and its trailing refresh after identity disagreement', async () => {
  let complete!: () => void;
  mockRefreshNumbers.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      complete = resolve;
    })
  );
  const { rerender, unmount } = renderHook(() => useWalletScreenData());
  const request = mockRefreshNumbers.mock.calls[0][0];
  act(() => {
    onAppState('background');
    onAppState('active');
  });
  mockCustomerUserId = 'other-user';
  rerender({});
  expect(request.isCurrent()).toBe(false);
  await act(async () => complete());
  expect(mockRefreshNumbers).toHaveBeenCalledTimes(1);
  unmount();
});

it('does not read while identities disagree and refreshes when they agree', () => {
  mockCustomerUserId = 'other-user';
  const { rerender, unmount } = renderHook(() => useWalletScreenData());
  act(() => {
    onAppState('background');
    onAppState('active');
  });
  expect(mockRefreshNumbers).not.toHaveBeenCalled();
  mockCustomerUserId = 'user-1';
  rerender({});
  expect(mockRefreshNumbers).toHaveBeenCalledTimes(1);
  unmount();
});

it.each([
  ['paused', 'offline'],
  ['pending', 'updating'],
  ['error', 'error'],
])('labels a numeric refresh in %s state as %s', (status, label) => {
  mockNumberStatus = status;
  const { result, unmount } = renderHook(() => useWalletScreenData());
  expect(result.current.refreshState).toBe(label);
  unmount();
});

it('refreshes on foreground return, ignores duplicate active events and removes the listener', async () => {
  const { unmount } = renderHook(() => useWalletScreenData());
  await act(async () => {});
  act(() => {
    onAppState('background');
    onAppState('active');
    onAppState('active');
  });
  expect(mockRefreshNumbers).toHaveBeenCalledTimes(2);
  expect(mockRefreshNumbers).toHaveBeenLastCalledWith(
    expect.objectContaining({ includeTransactions: true })
  );
  unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
