import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react-native';
import { type WalletQueryData, walletKeys } from '@/hooks/wallet-query';
import { useAuthStore } from '@/stores/auth-store';
import {
  createLiveWalletQuery,
  walletIdentitiesAgree,
} from './live-wallet-query';

jest.mock('@/lib/config', () => ({
  CONFIG: {
    MERCHANT_ID: 'configured-merchant',
    MERCHANT_SLUG: 'ogabassey',
  },
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

function createMockUser(id = 'user-1') {
  return {
    app_metadata: {},
    aud: 'authenticated',
    created_at: '2026-04-30T00:00:00.000Z',
    id,
    user_metadata: {},
  } as NonNullable<ReturnType<typeof useAuthStore.getState>['user']>;
}

function createTestClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false, gcTime: Number.POSITIVE_INFINITY },
    },
  });
}

function seedBalance(
  queryClient: QueryClient,
  key: ReturnType<typeof walletKeys.data>,
  balance: number
) {
  queryClient.setQueryData<WalletQueryData>(key, {
    wallet: { balance, loyalty_points: 0 },
    transactions: [],
  });
}

const keyFor = (ownerId: string, userId: string) =>
  walletKeys.data({ merchantId: 'merchant-1', ownerId, userId });

describe('live-wallet-query', () => {
  beforeEach(() => {
    useAuthStore.setState({
      customer: { id: 'customer-1', email: 'customer@example.com' },
      merchantId: 'merchant-1',
      user: createMockUser('user-1'),
    });
  });

  it('reads the balance under the live identity after a switch', () => {
    const queryClient = createTestClient();
    seedBalance(queryClient, keyFor('customer-1', 'user-1'), 750);
    seedBalance(queryClient, keyFor('customer-2', 'user-2'), 3200);
    const live = createLiveWalletQuery(queryClient);
    expect(live.getBalance()).toBe(750);

    useAuthStore.setState({
      customer: {
        id: 'customer-2',
        email: 'second@example.com',
        user_id: 'user-2',
      },
      user: createMockUser('user-2'),
    });

    expect(live.getBalance()).toBe(3200);
    expect(live.isSettled()).toBe(true);
    expect(live.getError()).toBeNull();
    queryClient.clear();
  });

  it('reports unsettled while the identities disagree despite cached data', () => {
    const queryClient = createTestClient();
    seedBalance(queryClient, keyFor('customer-1', 'user-1'), 750);
    seedBalance(queryClient, keyFor('customer-1', 'user-2'), 3200);
    const live = createLiveWalletQuery(queryClient);
    expect(live.isSettled()).toBe(true);

    useAuthStore.setState({
      customer: {
        id: 'customer-1',
        email: 'customer@example.com',
        user_id: 'user-1',
      },
      user: createMockUser('user-2'),
    });

    expect(live.isSettled()).toBe(false);
    queryClient.clear();
  });

  it('reports unsettled with a zero balance when no identity resolves', () => {
    const queryClient = createTestClient();
    seedBalance(queryClient, keyFor('customer-1', 'user-1'), 750);
    const live = createLiveWalletQuery(queryClient);
    expect(live.isSettled()).toBe(true);

    useAuthStore.setState({ customer: null, user: null });

    expect(live.isSettled()).toBe(false);
    expect(live.getBalance()).toBe(0);
    expect(live.isFetching()).toBe(false);
    expect(live.getError()).toBeNull();
    queryClient.clear();
  });

  it('reads fetch state under the live identity', async () => {
    const queryClient = createTestClient();
    seedBalance(queryClient, keyFor('customer-2', 'user-2'), 3200);
    useAuthStore.setState({
      customer: {
        id: 'customer-2',
        email: 'second@example.com',
        user_id: 'user-2',
      },
      user: createMockUser('user-2'),
    });
    const live = createLiveWalletQuery(queryClient);
    expect(live.isFetching()).toBe(false);

    let releaseFetch!: (value: WalletQueryData) => void;
    const pending = new Promise<WalletQueryData>((resolve) => {
      releaseFetch = resolve;
    });
    const inFlight = queryClient.fetchQuery({
      queryFn: () => pending,
      queryKey: keyFor('customer-2', 'user-2'),
    });
    await waitFor(() => expect(live.isFetching()).toBe(true));

    releaseFetch({
      wallet: { balance: 3200, loyalty_points: 0 },
      transactions: [],
    });
    await inFlight;
    expect(live.isFetching()).toBe(false);
    queryClient.clear();
  });

  it('reports a refetch failure after success until a later success', async () => {
    // Codex R80 P2: the failed refresh leaves stale data behind —
    // settled stays true while the latest request failed. A later
    // success clears the failure.
    const queryClient = createTestClient();
    const key = keyFor('customer-1', 'user-1');
    seedBalance(queryClient, key, 750);
    const live = createLiveWalletQuery(queryClient);
    expect(live.getError()).toBeNull();

    await queryClient
      .fetchQuery({
        queryFn: () => Promise.reject(new Error('wallet refresh failed')),
        queryKey: key,
      })
      .catch(() => undefined);

    expect(live.getError()).toEqual(new Error('wallet refresh failed'));
    expect(live.isSettled()).toBe(true);

    await queryClient.fetchQuery({
      queryFn: () =>
        Promise.resolve({
          wallet: { balance: 750, loyalty_points: 0 },
          transactions: [],
        }),
      queryKey: key,
    });

    expect(live.getError()).toBeNull();
    queryClient.clear();
  });

  it('reports presence for non-Error rejections', async () => {
    const queryClient = createTestClient();
    const key = keyFor('customer-1', 'user-1');
    seedBalance(queryClient, key, 750);
    const live = createLiveWalletQuery(queryClient);

    await queryClient
      .fetchQuery({
        queryFn: () => Promise.reject('string-fail'),
        queryKey: key,
      })
      .catch(() => undefined);

    expect(live.getError()).toBeInstanceOf(Error);
    queryClient.clear();
  });

  it('holds agreement until both present identities match', () => {
    expect(walletIdentitiesAgree({ id: 'c1', user_id: 'u1' }, 'u1')).toBe(true);
    expect(walletIdentitiesAgree({ id: 'c1', user_id: 'u1' }, 'u2')).toBe(
      false
    );
    expect(walletIdentitiesAgree({ id: 'c1' }, 'u1')).toBe(true);
    expect(walletIdentitiesAgree(null, 'u1')).toBe(true);
    expect(walletIdentitiesAgree({ id: 'c1', user_id: 'u1' }, null)).toBe(true);
  });
});
