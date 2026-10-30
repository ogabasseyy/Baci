import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useWalletScreenData } from '@/components/wallet/use-wallet-screen-data';
import { useWallet } from './use-wallet';
import { type WalletQueryData, walletKeys } from './wallet-query';

const mockFetch = jest.fn();
let mockMerchantId = 'merchant-1';
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('./wallet-data', () => ({
  fetchWalletData: (...args: unknown[]) => mockFetch(...args),
  fetchWalletDataUnbounded: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => {
      const channel = { on: () => channel, subscribe: jest.fn() };
      return channel;
    },
    removeChannel: jest.fn(),
  },
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: 'merchant-1' } }));
jest.mock('@/lib/wallet-funding-account', () => ({
  createWalletFundingAccount: jest.fn(),
}));
jest.mock('./use-redeem-points', () => ({ useRedeemPoints: jest.fn() }));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      customer: { id: 'customer-1', user_id: 'user-1' },
      user: { id: 'user-1' },
      merchantId: mockMerchantId,
    }),
}));

const key = walletKeys.data({
  merchantId: 'merchant-1',
  ownerId: 'customer-1',
  userId: 'user-1',
});
const saved: WalletQueryData = {
  wallet: {
    balance: 0,
    loyalty_points: 0,
    savings_balance: 200,
    total_balance: 200,
  },
  transactions: [],
};

beforeEach(() => {
  mockFetch.mockReset();
  mockMerchantId = 'merchant-1';
});
afterEach(() => jest.restoreAllMocks());

it('refreshes a recently cached display wallet on opening without blocking the saved snapshot', async () => {
  let complete!: (data: WalletQueryData) => void;
  mockFetch.mockReturnValue(
    new Promise<WalletQueryData>((resolve) => {
      complete = resolve;
    })
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(key, saved);
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(
    () => useWallet({ cachePolicy: 'display' }),
    { wrapper }
  );

  expect(result.current.data?.wallet.total_balance).toBe(200);
  expect(result.current.isLoading).toBe(false);
  const refreshedOnOpen = mockFetch.mock.calls.length;
  await act(async () =>
    complete({
      ...saved,
      wallet: { ...saved.wallet, savings_balance: 300, total_balance: 300 },
    })
  );

  expect(refreshedOnOpen).toBe(1);
  await waitFor(() =>
    expect(result.current.data?.wallet.total_balance).toBe(300)
  );
  unmount();
  client.clear();
});

it('rechecks the fresh target query key after merchant scope changes on the mounted screen', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(key, saved);
  client.setQueryData(
    walletKeys.data({
      merchantId: 'merchant-2',
      ownerId: 'customer-1',
      userId: 'user-1',
    }),
    saved
  );
  mockFetch.mockResolvedValue({
    ...saved,
    wallet: { ...saved.wallet, total_balance: 300 },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, rerender, unmount } = renderHook(
    () => useWalletScreenData(),
    { wrapper }
  );
  await waitFor(() =>
    expect(result.current.data?.wallet.total_balance).toBe(300)
  );

  mockFetch.mockResolvedValue({
    ...saved,
    wallet: { ...saved.wallet, total_balance: 400 },
  });
  mockMerchantId = 'merchant-2';
  rerender({});
  await waitFor(() =>
    expect(result.current.data?.wallet.total_balance).toBe(400)
  );
  expect(mockFetch).toHaveBeenLastCalledWith(
    'customer-1',
    'merchant-2',
    'user-1',
    expect.objectContaining({
      onBalances: expect.any(Function),
      readPrimary: expect.any(Function),
    })
  );
  unmount();
  client.clear();
});

it('reads the latest balance after resuming while a pre-credit snapshot is still loading', async () => {
  let onAppState!: (state: AppStateStatus) => void;
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      onAppState = callback;
      return { remove: jest.fn() };
    });
  let complete!: (data: WalletQueryData) => void;
  mockFetch.mockReturnValueOnce(
    new Promise<WalletQueryData>((resolve) => {
      complete = resolve;
    })
  );
  mockFetch.mockResolvedValue({
    ...saved,
    wallet: { ...saved.wallet, total_balance: 400 },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(key, saved);
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(() => useWalletScreenData(), {
    wrapper,
  });
  act(() => {
    onAppState('background');
    onAppState('active');
  });
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  await act(async () =>
    complete({ ...saved, wallet: { ...saved.wallet, total_balance: 300 } })
  );
  await waitFor(() =>
    expect(result.current.data?.wallet.total_balance).toBe(400)
  );
  expect(mockFetch).toHaveBeenCalledTimes(2);
  unmount();
  client.clear();
});
