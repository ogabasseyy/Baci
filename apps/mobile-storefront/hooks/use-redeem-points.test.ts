import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import * as Crypto from 'expo-crypto';
import { createElement, type PropsWithChildren } from 'react';
import type { WalletQueryData } from './wallet-query';
import { walletKeys } from './wallet-query';

const mockCalculateCommerce =
  jest.fn<(type: string, payload: unknown) => Promise<unknown>>();
const mockRpc = jest.fn<(name: string, params?: unknown) => Promise<unknown>>();
const mockGetReusablePendingLoyaltyRedemptionId =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetOrCreatePendingLoyaltyRedemptionId =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockClearPendingLoyaltyRedemptionId =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();

type MockAuthState = {
  customer: { id: string } | null;
  merchantId: string | null;
  user: { id: string } | null;
};

let mockAuthState: MockAuthState = {
  customer: { id: 'customer-1' },
  merchantId: 'merchant-1',
  user: { id: 'user-1' },
};

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'attempt-1'),
}));

jest.mock('@/lib/config', () => ({
  CONFIG: {
    MERCHANT_ID: 'configured-merchant',
  },
}));

jest.mock('@/lib/loyalty-redemption-idempotency', () => ({
  clearPendingLoyaltyRedemptionId: (...args: unknown[]) =>
    mockClearPendingLoyaltyRedemptionId(...args),
  getOrCreatePendingLoyaltyRedemptionId: (...args: unknown[]) =>
    mockGetOrCreatePendingLoyaltyRedemptionId(...args),
  getPendingLoyaltyRedemptionStorageKey: ({
    customerId,
    merchantId,
    points,
  }: {
    customerId: string;
    merchantId: string;
    points: number;
  }) => `loyalty-redemption:${customerId}:${merchantId}:${points}`,
  getReusablePendingLoyaltyRedemptionId: (...args: unknown[]) =>
    mockGetReusablePendingLoyaltyRedemptionId(...args),
}));

jest.mock('@/lib/commerce-brain', () => ({
  calculateCommerce: (type: string, payload: unknown) =>
    mockCalculateCommerce(type, payload),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, params?: unknown) => mockRpc(name, params),
  },
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: MockAuthState) => unknown) =>
    selector(mockAuthState),
}));

import { useRedeemPoints } from './use-redeem-points';

function createTestClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function createWalletData(points = 1000): WalletQueryData {
  return {
    transactions: [],
    wallet: {
      balance: 0,
      loyalty_points: points,
    },
  };
}

function setupHook(points = 1000) {
  const queryClient = createTestClient();
  const queryKey = walletKeys.data({
    merchantId: 'merchant-1',
    ownerId: 'customer-1',
  });
  queryClient.setQueryData(queryKey, createWalletData(points));
  const hook = renderHook(() => useRedeemPoints(), {
    wrapper: createWrapper(queryClient),
  });
  return { ...hook, queryClient, queryKey };
}

describe('useRedeemPoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState = {
      customer: { id: 'customer-1' },
      merchantId: 'merchant-1',
      user: { id: 'user-1' },
    };
    jest.mocked(Crypto.randomUUID).mockReturnValue('attempt-1');
    mockCalculateCommerce.mockResolvedValue({
      remainingPoints: 800,
      pointsRedeemed: 200,
      success: true,
      walletCredit: 200,
    });
    mockGetReusablePendingLoyaltyRedemptionId.mockResolvedValue(null);
    mockGetOrCreatePendingLoyaltyRedemptionId.mockResolvedValue({
      redemptionId: 'redemption-1',
    });
    mockClearPendingLoyaltyRedemptionId.mockResolvedValue(undefined);
    mockRpc.mockResolvedValue({
      data: {
        success: true,
        wallet_credited: 200,
        points_deducted: 200,
        new_points_balance: 800,
        new_wallet_balance: 200,
      },
      error: null,
    });
  });

  it('rejects missing customer auth before commerce or rpc calls', async () => {
    mockAuthState = {
      customer: null,
      merchantId: 'merchant-1',
      user: { id: 'user-1' },
    };
    const { result, unmount, queryClient } = setupHook();

    await act(async () => {
      await expect(result.current.mutateAsync(200)).rejects.toThrow(
        'Authentication required. Please sign in again.'
      );
    });

    expect(mockCalculateCommerce).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();

    unmount();
    queryClient.clear();
  });

  it('rejects invalid point values before commerce or rpc calls', async () => {
    const { result, unmount, queryClient } = setupHook();

    await act(async () => {
      await expect(result.current.mutateAsync(50)).rejects.toThrow(
        'Minimum redemption is 100 points'
      );
    });

    expect(mockCalculateCommerce).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();

    unmount();
    queryClient.clear();
  });

  it('rolls back optimistic points when rpc fails', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: new Error('rpc failed'),
    });
    const { result, unmount, queryClient, queryKey } = setupHook(1000);

    await act(async () => {
      await expect(result.current.mutateAsync(200)).rejects.toThrow(
        'rpc failed'
      );
    });

    expect(
      queryClient.getQueryData<WalletQueryData>(queryKey)?.wallet.loyalty_points
    ).toBe(1000);

    unmount();
    queryClient.clear();
  });

  it('allows reusable pending redemptions when cached points have refreshed lower', async () => {
    mockGetReusablePendingLoyaltyRedemptionId.mockResolvedValue({
      pointsBeforeRedeem: 1000,
      redemptionId: 'reused-redemption-id',
    });
    const { result, unmount, queryClient } = setupHook(0);

    await act(async () => {
      await result.current.mutateAsync(200);
    });

    expect(mockCalculateCommerce).toHaveBeenCalledWith(
      'redeem_loyalty',
      expect.objectContaining({
        currentPoints: 1000,
        points: 200,
      })
    );
    expect(mockRpc).toHaveBeenCalledWith(
      'redeem_loyalty_points',
      expect.objectContaining({
        p_redemption_id: 'reused-redemption-id',
      })
    );

    unmount();
    queryClient.clear();
  });
});
