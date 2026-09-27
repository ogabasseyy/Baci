import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { notifyManager } from '@tanstack/query-core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Crypto from 'expo-crypto';
import { createElement, type PropsWithChildren } from 'react';

const mockCalculateCommerce =
  jest.fn<(type: string, payload: unknown) => Promise<unknown>>();
const mockRpc = jest.fn<(name: string, params?: unknown) => Promise<unknown>>();
const mockFrom = jest.fn<(table: string) => unknown>();
const mockTrackEvent = jest.fn();
type RealtimeHandler = () => void;
const mockRealtimeHandlers: Record<string, RealtimeHandler[]> = {};

jest.mock('@/lib/commerce-brain', () => ({
  calculateCommerce: (type: string, payload: unknown) =>
    mockCalculateCommerce(type, payload),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: jest.fn(() => {
      const channel = {
        on: jest.fn((...args: unknown[]) => {
          const config = args[1] as { table?: string };
          const callback = args[2] as RealtimeHandler;
          if (config.table) {
            mockRealtimeHandlers[config.table] = [
              ...(mockRealtimeHandlers[config.table] ?? []),
              callback,
            ];
          }
          return channel;
        }),
        subscribe: jest.fn(),
      };
      return channel;
    }),
    from: (table: string) => mockFrom(table),
    removeChannel: jest.fn(),
    rpc: (name: string, params?: unknown) => mockRpc(name, params),
  },
}));

jest.mock('@/lib/config', () => ({
  CONFIG: {
    MERCHANT_ID: 'configured-merchant',
    MERCHANT_SLUG: 'ogabassey',
  },
}));

jest.mock('@/services/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'test-redemption-id'),
}));

jest.mock('@/stores/auth-store', () => {
  const { create } = require('zustand');

  return {
    useAuthStore: create(() => ({
      customer: { id: 'customer-1', email: 'customer@example.com' },
      merchantId: 'merchant-1',
      user: { id: 'user-1' },
    })),
  };
});

import { useRedeemPoints, useWallet, walletKeys } from '@/hooks/use-wallet';
import { PENDING_LOYALTY_REDEMPTION_TTL_MS } from '@/lib/loyalty-redemption-idempotency';
import { useAuthStore } from '@/stores/auth-store';

function createMockUser(id = 'user-1') {
  return {
    app_metadata: {},
    aud: 'authenticated',
    created_at: '2026-04-30T00:00:00.000Z',
    id,
    user_metadata: {},
  } as NonNullable<ReturnType<typeof useAuthStore.getState>['user']>;
}

type WalletQueryData = {
  wallet: { balance: number; loyalty_points: number };
  transactions: Array<{
    id: string;
    type:
      | 'credit'
      | 'debit'
      | 'cashback'
      | 'redemption'
      | 'bonus'
      | 'adjustment'
      | 'expiry'
      | 'refund';
    amount: number;
    description: string;
    created_at: string;
  }>;
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

function createTestClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false, gcTime: Number.POSITIVE_INFINITY },
    },
  });
}

function setupHook() {
  const queryClient = createTestClient();
  queryClient.setQueryData<WalletQueryData>(
    walletKeys.data({ merchantId: 'merchant-1', ownerId: 'customer-1' }),
    {
      wallet: { balance: 0, loyalty_points: 1000 },
      transactions: [],
    }
  );

  const hook = renderHook(() => useRedeemPoints(), {
    wrapper: createWrapper(queryClient),
  });

  return { ...hook, queryClient };
}

beforeEach(async () => {
  jest.clearAllMocks();
  for (const table of Object.keys(mockRealtimeHandlers)) {
    delete mockRealtimeHandlers[table];
  }
  jest.mocked(Crypto.randomUUID).mockReset();
  jest.mocked(Crypto.randomUUID).mockReturnValue('test-redemption-id');
  await AsyncStorage.clear();

  act(() => {
    useAuthStore.setState({
      customer: { id: 'customer-1', email: 'customer@example.com' },
      merchantId: 'merchant-1',
      user: createMockUser('user-1'),
    });
  });

  mockCalculateCommerce.mockResolvedValue({
    success: true,
    walletCredit: 100,
    pointsRedeemed: 100,
    remainingPoints: 900,
  });
});

function createQueryResult(data: unknown, error: unknown = null) {
  return { data, error };
}

function setupWalletTableMocks({
  customerResult = createQueryResult([
    { id: 'customer-1', loyalty_points: 1200 },
  ]),
  fundingAccountResult = createQueryResult(null),
  savingsGoalsResult = createQueryResult([]),
  transactionsResult = createQueryResult([
    {
      amount: 500,
      created_at: '2026-04-01T00:00:00.000Z',
      description: 'Cashback - Airtime MTN ₦1500',
      id: 'wallet-tx-1',
      type: 'cashback',
    },
  ]),
  walletResult = createQueryResult({
    available_balance: 750,
    id: 'wallet-1',
  }),
}: {
  customerResult?: ReturnType<typeof createQueryResult>;
  fundingAccountResult?: ReturnType<typeof createQueryResult>;
  savingsGoalsResult?: ReturnType<typeof createQueryResult>;
  transactionsResult?: ReturnType<typeof createQueryResult>;
  walletResult?: ReturnType<typeof createQueryResult>;
} = {}) {
  const normalizedCustomerResult = Array.isArray(customerResult.data)
    ? customerResult
    : createQueryResult(
        customerResult.data ? [customerResult.data] : [],
        customerResult.error
      );
  const customerLimit = jest
    .fn<() => Promise<ReturnType<typeof createQueryResult>>>()
    .mockResolvedValue(normalizedCustomerResult);
  const walletMaybeSingle = jest
    .fn<() => Promise<ReturnType<typeof createQueryResult>>>()
    .mockResolvedValue(walletResult);
  const txLimit = jest
    .fn<() => Promise<ReturnType<typeof createQueryResult>>>()
    .mockResolvedValue(transactionsResult);
  const accountMaybeSingle = jest
    .fn<() => Promise<ReturnType<typeof createQueryResult>>>()
    .mockResolvedValue(fundingAccountResult);
  const savingsOrder = jest
    .fn<() => Promise<ReturnType<typeof createQueryResult>>>()
    .mockResolvedValue(savingsGoalsResult);
  const tableCalls: string[] = [];
  const customerFilters: [string, unknown][] = [];
  const transactionFilters: [string, unknown][] = [];

  mockFrom.mockImplementation((table: string) => {
    tableCalls.push(table);

    if (table === 'customers') {
      const customerEqChain = {
        eq: jest.fn((column: string, value: unknown) => {
          customerFilters.push([column, value]);
          return customerEqChain;
        }),
        limit: customerLimit,
      };

      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn((column: string, value: unknown) => {
            customerFilters.push([column, value]);
            return customerEqChain;
          }),
        }),
      };
    }

    if (table === 'customer_wallets') {
      const walletEqChain = {
        eq: jest.fn(() => walletEqChain),
        maybeSingle: walletMaybeSingle,
      };

      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn(() => walletEqChain),
        }),
      };
    }

    if (table === 'customer_wallet_transactions') {
      const txEqChain = {
        eq: jest.fn((column: string, value: unknown) => {
          transactionFilters.push([column, value]);
          return txEqChain;
        }),
        order: jest.fn().mockReturnValue({ limit: txLimit }),
      };

      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn((column: string, value: unknown) => {
            transactionFilters.push([column, value]);
            return txEqChain;
          }),
        }),
      };
    }

    if (table === 'customer_wallet_payment_accounts') {
      const accountEqChain = {
        eq: jest.fn(() => accountEqChain),
        maybeSingle: accountMaybeSingle,
      };

      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn(() => accountEqChain),
        }),
      };
    }

    if (table === 'customer_savings_goals') {
      const savingsEqChain = {
        eq: jest.fn(() => savingsEqChain),
        in: jest.fn(() => ({
          order: savingsOrder,
        })),
      };

      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn(() => savingsEqChain),
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return { customerFilters, tableCalls, transactionFilters };
}

describe('useWallet', () => {
  it('reads customer wallet transactions instead of merchant wallet transactions', async () => {
    const { tableCalls, transactionFilters } = setupWalletTableMocks();
    const queryClient = createTestClient();

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(tableCalls).toContain('customer_wallet_transactions');
    expect(tableCalls).not.toContain('wallet_transactions');
    expect(transactionFilters).toEqual([
      ['wallet_id', 'wallet-1'],
      ['merchant_id', 'merchant-1'],
    ]);
    expect(result.current.data?.transactions).toEqual([
      expect.objectContaining({
        amount: 500,
        description: 'Cashback - Airtime MTN ₦1500',
        type: 'cashback',
      }),
    ]);

    unmount();
    queryClient.clear();
  });

  it('normalizes wallet numeric fields returned as Postgres strings', async () => {
    setupWalletTableMocks({
      transactionsResult: createQueryResult([
        {
          amount: '0.75',
          created_at: '2026-04-30T20:53:51.407Z',
          description: 'Cashback - Airtime MTN ₦100',
          id: 'wallet-tx-1',
          type: 'cashback',
        },
      ]),
      walletResult: createQueryResult({
        available_balance: '3.25',
        id: 'wallet-1',
      }),
    });
    const queryClient = createTestClient();

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.wallet.balance).toBe(3.25);
    expect(result.current.data?.transactions).toEqual([
      expect.objectContaining({
        amount: 0.75,
        description: 'Cashback - Airtime MTN ₦100',
        type: 'cashback',
      }),
    ]);

    unmount();
    queryClient.clear();
  });

  it('adds savings balance and funding account data to the wallet payload', async () => {
    setupWalletTableMocks({
      fundingAccountResult: createQueryResult({
        account_name: 'Ogabassey/Jane Doe',
        account_number: '1234567890',
        bank_name: 'Titan Paystack',
        provider: 'paystack',
      }),
      savingsGoalsResult: createQueryResult([
        { current_amount: '20000' },
        { current_amount: '15000.5' },
      ]),
      walletResult: createQueryResult({
        available_balance: '5000',
        id: 'wallet-1',
      }),
    });
    const queryClient = createTestClient();

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.wallet).toMatchObject({
      balance: 5000,
      earnings_balance: 5000,
      funding_account: {
        account_name: 'Ogabassey/Jane Doe',
        account_number: '1234567890',
        bank_name: 'Titan Paystack',
        provider: 'paystack',
      },
      loyalty_points: 1200,
      requires_funding_account_consent: false,
      savings_balance: 35000.5,
      total_balance: 40000.5,
    });

    unmount();
    queryClient.clear();
  });

  it('drops malformed wallet funding account rows from the wallet payload', async () => {
    setupWalletTableMocks({
      fundingAccountResult: createQueryResult({
        account_name: 'Ogabassey/Jane Doe',
        account_number: 'not-an-account',
        bank_name: 'Titan Paystack',
        provider: 'paystack',
      }),
      walletResult: createQueryResult({
        available_balance: '5000',
        id: 'wallet-1',
      }),
    });
    const queryClient = createTestClient();

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.wallet.funding_account).toBeNull();
    expect(result.current.data?.wallet.requires_funding_account_consent).toBe(
      true
    );

    unmount();
    queryClient.clear();
  });

  it('preserves refund rows in wallet transaction history', async () => {
    setupWalletTableMocks({
      transactionsResult: createQueryResult([
        {
          amount: '1200',
          created_at: '2026-05-01T09:00:00.000Z',
          description: 'Refund - Wallet top-up',
          id: 'wallet-refund-1',
          type: 'refund',
        },
      ]),
    });
    const queryClient = createTestClient();

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.transactions).toEqual([
      expect.objectContaining({
        amount: 1200,
        description: 'Refund - Wallet top-up',
        type: 'refund',
      }),
    ]);

    unmount();
    queryClient.clear();
  });

  it('loads wallet data while customer hydration is still pending', async () => {
    const { customerFilters } = setupWalletTableMocks({
      customerResult: createQueryResult({
        id: 'customer-1',
        loyalty_points: 1200,
      }),
      walletResult: createQueryResult({
        available_balance: '3.25',
        id: 'wallet-1',
      }),
    });
    act(() => {
      useAuthStore.setState({
        customer: null,
        merchantId: 'merchant-1',
        user: createMockUser('user-1'),
      });
    });
    const queryClient = createTestClient();

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.wallet).toMatchObject({
      balance: 3.25,
      loyalty_points: 1200,
    });
    expect(customerFilters).toContainEqual(['user_id', 'user-1']);

    unmount();
    queryClient.clear();
  });

  it('returns an empty wallet when customer lookup has no rows', async () => {
    const { tableCalls } = setupWalletTableMocks({
      customerResult: createQueryResult([]),
    });
    const queryClient = createTestClient();

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toMatchObject({
      wallet: { balance: 0, loyalty_points: 0 },
      transactions: [],
    });
    expect(tableCalls).not.toContain('customer_wallets');

    unmount();
    queryClient.clear();
  });

  it('keeps the wallet query idle without querying when no owner identifier is available', () => {
    act(() => {
      useAuthStore.setState({
        customer: null,
        merchantId: 'merchant-1',
        user: null,
      });
    });
    const { tableCalls } = setupWalletTableMocks();
    const queryClient = createTestClient();

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(tableCalls).toEqual([]);

    unmount();
    queryClient.clear();
  });

  it('returns an empty wallet and warns when customer lookup has multiple rows', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { tableCalls } = setupWalletTableMocks({
      customerResult: createQueryResult([
        { id: 'customer-1', loyalty_points: 1200 },
        { id: 'customer-2', loyalty_points: 900 },
      ]),
    });
    const queryClient = createTestClient();

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toMatchObject({
      wallet: { balance: 0, loyalty_points: 0 },
      transactions: [],
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Expected one customer wallet owner, received multiple rows',
      {
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        userId: 'user-1',
      }
    );
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'multiple_customer_wallet_owner',
      {
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        numberOfRows: 2,
        severity: 'data_integrity',
        userId: 'user-1',
      }
    );
    expect(tableCalls).not.toContain('customer_wallets');

    warnSpy.mockRestore();
    unmount();
    queryClient.clear();
  });

  it('uses the configured merchant when auth merchant hydration is still pending', async () => {
    const { customerFilters } = setupWalletTableMocks({
      customerResult: createQueryResult({
        id: 'customer-1',
        loyalty_points: 1200,
      }),
      walletResult: createQueryResult({
        available_balance: '3.25',
        id: 'wallet-1',
      }),
    });
    act(() => {
      useAuthStore.setState({
        customer: null,
        merchantId: null,
        user: createMockUser('user-1'),
      });
    });
    const queryClient = createTestClient();

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.wallet.balance).toBe(3.25);
    expect(customerFilters).toContainEqual([
      'merchant_id',
      'configured-merchant',
    ]);

    unmount();
    queryClient.clear();
  });

  it('reports an error when the customer wallet query fails', async () => {
    const { tableCalls } = setupWalletTableMocks({
      walletResult: createQueryResult(null, { message: 'wallet query failed' }),
    });
    const queryClient = createTestClient();

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual({ message: 'wallet query failed' });
    expect(tableCalls).toContain('customer_wallets');

    unmount();
    queryClient.clear();
  });

  it('returns an empty wallet when no wallet row exists yet', async () => {
    const { tableCalls } = setupWalletTableMocks({
      walletResult: createQueryResult(null),
    });
    const queryClient = createTestClient();

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.wallet).toMatchObject({
      balance: 0,
      earnings_balance: 0,
      loyalty_points: 1200,
      savings_balance: 0,
      total_balance: 0,
      funding_account: null,
      requires_funding_account_consent: true,
    });
    expect(result.current.data?.transactions).toEqual([]);
    expect(tableCalls).not.toContain('customer_wallet_transactions');

    unmount();
    queryClient.clear();
  });

  it('returns an empty transaction list when the wallet has no transactions', async () => {
    setupWalletTableMocks({
      transactionsResult: createQueryResult([]),
    });
    const queryClient = createTestClient();

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.transactions).toEqual([]);

    unmount();
    queryClient.clear();
  });

  it('reports an error when the wallet transactions query fails', async () => {
    setupWalletTableMocks({
      transactionsResult: createQueryResult(null, {
        message: 'transactions query failed',
      }),
    });
    const queryClient = createTestClient();

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual({
      message: 'transactions query failed',
    });

    unmount();
    queryClient.clear();
  });

  it('debounces savings realtime invalidations across goals and contributions', async () => {
    setupWalletTableMocks();
    const queryClient = createTestClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    invalidateSpy.mockClear();

    act(() => {
      mockRealtimeHandlers.customer_savings_goals?.[0]?.();
      mockRealtimeHandlers.customer_savings_contributions?.[0]?.();
      mockRealtimeHandlers.customer_savings_contributions?.[0]?.();
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(1));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: walletKeys.data({
        merchantId: 'merchant-1',
        ownerId: 'customer-1',
      }),
    });

    unmount();
    queryClient.clear();
  });

  it('keeps display wallet cache fresh across quick wallet-screen returns', () => {
    const { tableCalls } = setupWalletTableMocks();
    const queryClient = createTestClient();
    queryClient.setQueryData<WalletQueryData>(
      walletKeys.data({ merchantId: 'merchant-1', ownerId: 'customer-1' }),
      {
        wallet: { balance: 3210, loyalty_points: 400 },
        transactions: [],
      },
      { updatedAt: Date.now() - 45_000 }
    );

    const { result, unmount } = renderHook(
      () => useWallet({ cachePolicy: 'display' }),
      {
        wrapper: createWrapper(queryClient),
      }
    );

    expect(result.current.data?.wallet.balance).toBe(3210);
    expect(tableCalls).toEqual([]);

    unmount();
    queryClient.clear();
  });

  it('keeps the default wallet cache strict for balance-sensitive consumers', async () => {
    const { tableCalls } = setupWalletTableMocks();
    const queryClient = createTestClient();
    queryClient.setQueryData<WalletQueryData>(
      walletKeys.data({ merchantId: 'merchant-1', ownerId: 'customer-1' }),
      {
        wallet: { balance: 3210, loyalty_points: 400 },
        transactions: [],
      },
      { updatedAt: Date.now() - 45_000 }
    );

    const { result, unmount } = renderHook(() => useWallet(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.data?.wallet.balance).toBe(3210);
    await waitFor(() => expect(tableCalls).toContain('customers'));

    unmount();
    queryClient.clear();
  });
});

beforeAll(() => {
  notifyManager.setNotifyFunction((callback) => {
    act(() => {
      callback();
    });
  });
});

afterAll(() => {
  notifyManager.setNotifyFunction((callback) => {
    callback();
  });
});

describe('useRedeemPoints', () => {
  it('throws when redeem_loyalty_points RPC returns malformed data', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, wallet_credited: 500 },
      error: null,
    });

    const { result, unmount, queryClient } = setupHook();

    await act(async () => {
      await expect(result.current.mutateAsync(100)).rejects.toThrow(
        'Invalid redeem_loyalty_points RPC response'
      );
    });
    unmount();
    queryClient.clear();
  });

  it('throws server-provided error when redeem_loyalty_points returns success=false', async () => {
    mockRpc.mockResolvedValue({
      data: { success: false, error: 'Insufficient points' },
      error: null,
    });

    const { result, unmount, queryClient } = setupHook();

    await act(async () => {
      await expect(result.current.mutateAsync(100)).rejects.toThrow(
        'Insufficient points'
      );
    });
    unmount();
    queryClient.clear();
  });

  it('maps successful redeem_loyalty_points RPC values into mutation result', async () => {
    mockCalculateCommerce.mockResolvedValue({
      success: true,
      walletCredit: 200,
      pointsRedeemed: 200,
      remainingPoints: 800,
    });
    mockRpc.mockResolvedValue({
      data: {
        success: true,
        wallet_credited: 200,
        points_deducted: 200,
        new_points_balance: 800,
        new_wallet_balance: 12500,
      },
      error: null,
    });

    const { result, unmount, queryClient } = setupHook();
    let response:
      | {
          success: boolean;
          walletCredit: number;
          pointsRedeemed: number;
          remainingPoints: number;
        }
      | undefined;

    await act(async () => {
      response = (await result.current.mutateAsync(200)) as {
        success: boolean;
        walletCredit: number;
        pointsRedeemed: number;
        remainingPoints: number;
      };
    });

    expect(response).toMatchObject({
      success: true,
      walletCredit: 200,
      pointsRedeemed: 200,
      remainingPoints: 800,
    });
    expect(mockRpc).toHaveBeenCalledWith('redeem_loyalty_points', {
      p_customer_id: 'customer-1',
      p_merchant_id: 'merchant-1',
      p_points: 200,
      p_redemption_id: 'test-redemption-id',
      p_wallet_credit: 200,
    });
    unmount();
    queryClient.clear();
  });

  it('rejects redemption below 100 points before calling rpc', async () => {
    const { result, unmount, queryClient } = setupHook();

    await act(async () => {
      await expect(result.current.mutateAsync(50)).rejects.toThrow(
        'Minimum redemption is 100 points'
      );
    });
    expect(mockCalculateCommerce).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<WalletQueryData>(
        walletKeys.data({ merchantId: 'merchant-1', ownerId: 'customer-1' })
      )?.wallet.loyalty_points
    ).toBe(1000);
    unmount();
    queryClient.clear();
  });

  it('rejects non-integer redemption amounts before calling rpc', async () => {
    const { result, unmount, queryClient } = setupHook();

    await act(async () => {
      await expect(result.current.mutateAsync(100.5)).rejects.toThrow(
        'Invalid redemption amount'
      );
    });
    expect(mockCalculateCommerce).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<WalletQueryData>(
        walletKeys.data({ merchantId: 'merchant-1', ownerId: 'customer-1' })
      )?.wallet.loyalty_points
    ).toBe(1000);
    unmount();
    queryClient.clear();
  });

  it('rejects redemption amounts outside 100-point blocks before calling rpc', async () => {
    const { result, unmount, queryClient } = setupHook();

    await act(async () => {
      await expect(result.current.mutateAsync(150)).rejects.toThrow(
        'Redeem points in 100-point blocks'
      );
    });
    expect(mockCalculateCommerce).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<WalletQueryData>(
        walletKeys.data({ merchantId: 'merchant-1', ownerId: 'customer-1' })
      )?.wallet.loyalty_points
    ).toBe(1000);
    unmount();
    queryClient.clear();
  });

  it('rolls back and invalidates the query key captured before auth changes', async () => {
    let rejectCommerce: ((reason?: Error) => void) | undefined;
    mockCalculateCommerce.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectCommerce = reject;
      })
    );
    const { result, unmount, queryClient } = setupHook();
    const originalQueryKey = walletKeys.data({
      merchantId: 'merchant-1',
      ownerId: 'customer-1',
    });
    const changedQueryKey = walletKeys.data({
      merchantId: 'merchant-2',
      ownerId: 'customer-2',
    });
    queryClient.setQueryData<WalletQueryData>(originalQueryKey, {
      wallet: { balance: 0, loyalty_points: 1000 },
      transactions: [],
    });
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    let mutationPromise!: Promise<unknown>;
    act(() => {
      mutationPromise = result.current.mutateAsync(100);
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<WalletQueryData>(originalQueryKey)?.wallet
          .loyalty_points
      ).toBe(900)
    );

    act(() => {
      useAuthStore.setState({
        customer: { id: 'customer-2', email: 'changed@example.com' },
        merchantId: 'merchant-2',
        user: createMockUser('user-2'),
      });
    });

    await act(async () => {
      rejectCommerce?.(new Error('commerce failed'));
      await expect(mutationPromise).rejects.toThrow('commerce failed');
    });

    expect(queryClient.getQueryData<WalletQueryData>(originalQueryKey)).toEqual(
      {
        wallet: { balance: 0, loyalty_points: 1000 },
        transactions: [],
      }
    );
    expect(queryClient.getQueryData(changedQueryKey)).toBeUndefined();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: originalQueryKey,
    });

    invalidateSpy.mockRestore();
    unmount();
    queryClient.clear();
  });

  it('rejects redemption above the cached point balance before calling commerce or rpc', async () => {
    const { result, unmount, queryClient } = setupHook();
    const queryKey = walletKeys.data({
      merchantId: 'merchant-1',
      ownerId: 'customer-1',
    });
    queryClient.setQueryData<WalletQueryData>(queryKey, {
      wallet: { balance: 0, loyalty_points: 50 },
      transactions: [],
    });

    await act(async () => {
      await expect(result.current.mutateAsync(100)).rejects.toThrow(
        'Insufficient loyalty points'
      );
    });

    expect(mockCalculateCommerce).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<WalletQueryData>(queryKey)?.wallet.loyalty_points
    ).toBe(50);
    unmount();
    queryClient.clear();
  });

  it('reuses the same redemption id after an ambiguous rpc error retry', async () => {
    jest
      .mocked(Crypto.randomUUID)
      .mockReturnValueOnce('live-attempt-id')
      .mockReturnValueOnce('first-redemption-id');
    mockCalculateCommerce.mockResolvedValue({
      success: true,
      walletCredit: 200,
      pointsRedeemed: 200,
      remainingPoints: 800,
    });
    mockRpc
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce({
        data: {
          success: true,
          wallet_credited: 200,
          points_deducted: 200,
          new_points_balance: 800,
          new_wallet_balance: 12500,
        },
        error: null,
      });

    const { result, unmount, queryClient } = setupHook();

    await act(async () => {
      await expect(result.current.mutateAsync(200)).rejects.toThrow(
        'Network request failed'
      );
    });

    await act(async () => {
      await result.current.mutateAsync(200);
    });

    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      'redeem_loyalty_points',
      expect.objectContaining({ p_redemption_id: 'first-redemption-id' })
    );
    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      'redeem_loyalty_points',
      expect.objectContaining({ p_redemption_id: 'first-redemption-id' })
    );
    expect(Crypto.randomUUID).toHaveBeenCalledTimes(2);

    unmount();
    queryClient.clear();
  });

  it('retries an ambiguous redemption after a wallet balance refresh lowers points', async () => {
    jest
      .mocked(Crypto.randomUUID)
      .mockReturnValueOnce('live-attempt-id')
      .mockReturnValueOnce('first-redemption-id');
    mockCalculateCommerce.mockResolvedValue({
      success: true,
      walletCredit: 200,
      pointsRedeemed: 200,
      remainingPoints: 0,
    });
    mockRpc
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce({
        data: {
          success: true,
          wallet_credited: 200,
          points_deducted: 200,
          new_points_balance: 0,
          new_wallet_balance: 12500,
        },
        error: null,
      });

    const { result, unmount, queryClient } = setupHook();
    const queryKey = walletKeys.data({
      merchantId: 'merchant-1',
      ownerId: 'customer-1',
    });
    queryClient.setQueryData<WalletQueryData>(queryKey, {
      wallet: { balance: 0, loyalty_points: 200 },
      transactions: [],
    });

    await act(async () => {
      await expect(result.current.mutateAsync(200)).rejects.toThrow(
        'Network request failed'
      );
    });

    queryClient.setQueryData<WalletQueryData>(queryKey, {
      wallet: { balance: 0, loyalty_points: 0 },
      transactions: [],
    });

    await act(async () => {
      await result.current.mutateAsync(200);
    });

    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      'redeem_loyalty_points',
      expect.objectContaining({ p_redemption_id: 'first-redemption-id' })
    );
    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      'redeem_loyalty_points',
      expect.objectContaining({ p_redemption_id: 'first-redemption-id' })
    );
    expect(mockCalculateCommerce).toHaveBeenNthCalledWith(
      1,
      'redeem_loyalty',
      expect.objectContaining({ currentPoints: 200, points: 200 })
    );
    expect(mockCalculateCommerce).toHaveBeenNthCalledWith(
      2,
      'redeem_loyalty',
      expect.objectContaining({ currentPoints: 200, points: 200 })
    );

    unmount();
    queryClient.clear();
  });

  it('uses a fresh redemption id when a live retry outlives the pending ttl', async () => {
    jest
      .mocked(Crypto.randomUUID)
      .mockReturnValueOnce('live-attempt-id')
      .mockReturnValueOnce('expired-redemption-id')
      .mockReturnValueOnce('fresh-redemption-id');
    mockCalculateCommerce.mockResolvedValue({
      success: true,
      walletCredit: 200,
      pointsRedeemed: 200,
      remainingPoints: 800,
    });
    mockRpc
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce({
        data: {
          success: true,
          wallet_credited: 200,
          points_deducted: 200,
          new_points_balance: 800,
          new_wallet_balance: 12500,
        },
        error: null,
      });

    const { result, unmount, queryClient } = setupHook();

    await act(async () => {
      await expect(result.current.mutateAsync(200)).rejects.toThrow(
        'Network request failed'
      );
    });
    await AsyncStorage.setItem(
      'loyalty-redemption:customer-1:merchant-1:200',
      JSON.stringify({
        attemptId: 'live-attempt-id',
        createdAt: Date.now() - PENDING_LOYALTY_REDEMPTION_TTL_MS - 1,
        pointsBeforeRedeem: 1000,
        redemptionId: 'expired-redemption-id',
        version: 2,
      })
    );

    await act(async () => {
      await result.current.mutateAsync(200);
    });

    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      'redeem_loyalty_points',
      expect.objectContaining({ p_redemption_id: 'expired-redemption-id' })
    );
    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      'redeem_loyalty_points',
      expect.objectContaining({ p_redemption_id: 'fresh-redemption-id' })
    );
    expect(Crypto.randomUUID).toHaveBeenCalledTimes(3);

    unmount();
    queryClient.clear();
  });

  it('does not reuse a stale same-amount redemption id after the point balance changes', async () => {
    jest
      .mocked(Crypto.randomUUID)
      .mockReturnValueOnce('new-attempt-id')
      .mockReturnValueOnce('new-redemption-id');
    mockCalculateCommerce.mockResolvedValue({
      success: true,
      walletCredit: 200,
      pointsRedeemed: 200,
      remainingPoints: 600,
    });
    mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        wallet_credited: 200,
        points_deducted: 200,
        new_points_balance: 600,
        new_wallet_balance: 12500,
      },
      error: null,
    });
    await AsyncStorage.setItem(
      'loyalty-redemption:customer-1:merchant-1:200',
      JSON.stringify({
        attemptId: 'previous-attempt-id',
        createdAt: Date.now(),
        pointsBeforeRedeem: 1000,
        redemptionId: 'stale-redemption-id',
        version: 2,
      })
    );

    const { result, unmount, queryClient } = setupHook();
    queryClient.setQueryData<WalletQueryData>(
      walletKeys.data({ merchantId: 'merchant-1', ownerId: 'customer-1' }),
      {
        wallet: { balance: 0, loyalty_points: 800 },
        transactions: [],
      }
    );

    await act(async () => {
      await result.current.mutateAsync(200);
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'redeem_loyalty_points',
      expect.objectContaining({
        p_redemption_id: 'new-redemption-id',
      })
    );

    unmount();
    queryClient.clear();
  });

  it('does not reuse a persisted redemption id after remounting before retry', async () => {
    jest
      .mocked(Crypto.randomUUID)
      .mockReturnValueOnce('first-attempt-id')
      .mockReturnValueOnce('first-redemption-id')
      .mockReturnValueOnce('second-attempt-id')
      .mockReturnValueOnce('second-redemption-id');
    mockCalculateCommerce.mockResolvedValue({
      success: true,
      walletCredit: 200,
      pointsRedeemed: 200,
      remainingPoints: 800,
    });
    mockRpc.mockRejectedValueOnce(new Error('Network request failed'));

    const first = setupHook();

    await act(async () => {
      await expect(first.result.current.mutateAsync(200)).rejects.toThrow(
        'Network request failed'
      );
    });
    first.unmount();
    first.queryClient.clear();

    mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        wallet_credited: 200,
        points_deducted: 200,
        new_points_balance: 800,
        new_wallet_balance: 12500,
      },
      error: null,
    });

    const second = setupHook();

    await act(async () => {
      await second.result.current.mutateAsync(200);
    });

    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      'redeem_loyalty_points',
      expect.objectContaining({ p_redemption_id: 'first-redemption-id' })
    );
    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      'redeem_loyalty_points',
      expect.objectContaining({ p_redemption_id: 'second-redemption-id' })
    );
    expect(Crypto.randomUUID).toHaveBeenCalledTimes(4);

    second.unmount();
    second.queryClient.clear();
  });

  it('does not reuse a pending redemption id across customer or merchant changes', async () => {
    jest
      .mocked(Crypto.randomUUID)
      .mockReturnValueOnce('attempt-id-1')
      .mockReturnValueOnce('redemption-id-1')
      .mockReturnValueOnce('attempt-id-2')
      .mockReturnValueOnce('redemption-id-2');
    mockCalculateCommerce.mockResolvedValue({
      success: true,
      walletCredit: 200,
      pointsRedeemed: 200,
      remainingPoints: 800,
    });
    mockRpc
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce({
        data: {
          success: true,
          wallet_credited: 200,
          points_deducted: 200,
          new_points_balance: 800,
          new_wallet_balance: 12500,
        },
        error: null,
      });

    const { result, unmount, queryClient } = setupHook();

    await act(async () => {
      await expect(result.current.mutateAsync(200)).rejects.toThrow(
        'Network request failed'
      );
    });

    act(() => {
      useAuthStore.setState({
        customer: { id: 'customer-2', email: 'changed@example.com' },
        merchantId: 'merchant-2',
        user: createMockUser('user-2'),
      });
    });
    queryClient.setQueryData<WalletQueryData>(
      walletKeys.data({ merchantId: 'merchant-2', ownerId: 'customer-2' }),
      {
        wallet: { balance: 0, loyalty_points: 1000 },
        transactions: [],
      }
    );

    await act(async () => {
      await result.current.mutateAsync(200);
    });

    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      'redeem_loyalty_points',
      expect.objectContaining({
        p_customer_id: 'customer-1',
        p_merchant_id: 'merchant-1',
        p_redemption_id: 'redemption-id-1',
      })
    );
    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      'redeem_loyalty_points',
      expect.objectContaining({
        p_customer_id: 'customer-2',
        p_merchant_id: 'merchant-2',
        p_redemption_id: 'redemption-id-2',
      })
    );

    unmount();
    queryClient.clear();
  });
});
