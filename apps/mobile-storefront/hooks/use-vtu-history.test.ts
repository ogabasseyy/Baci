import { jest } from '@jest/globals';
import { notifyManager } from '@tanstack/query-core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type PropsWithChildren } from 'react';
import { useVTUHistory } from '@/hooks/use-vtu-history';
import {
  clearPendingVtuKeys,
  isStalePendingVtuSuccess,
  markPendingVtuCompleted,
  notePendingVtuReference,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from '@/lib/pending-vtu-idempotency';

type MockFetchResponse = {
  ok: boolean;
  json: () => Promise<Record<string, unknown>>;
};

type MockUserResult = {
  data: { user: { id: string } | null };
  error: Error | null;
};

type MockSessionResult = {
  data: { session: { access_token: string } | null };
  error: Error | null;
};

// Real shared helper under test (R72): global fetch is the seam,
// typed loosely so response literals stay terse.
const fetchSpy = jest.spyOn(global, 'fetch') as unknown as jest.Mock<
  (url: string, init?: RequestInit) => Promise<MockFetchResponse>
>;
const mockGetUser = jest.fn<() => Promise<MockUserResult>>();
const mockGetSession = jest.fn<() => Promise<MockSessionResult>>();
const mockAuthUserId = jest.fn<() => string | null>();

jest.mock('@/lib/fetch-with-timeout', () => ({
  SHORT_TIMEOUT: 10000,
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => mockGetUser(),
      getSession: () => mockGetSession(),
    },
  },
}));

jest.mock('@/stores/auth-store', () => {
  const state = () => {
    const id = mockAuthUserId();
    return { user: id ? { id } : null };
  };
  return {
    useAuthStore: Object.assign(
      jest.fn((selector: (state: { user: { id: string } | null }) => unknown) =>
        selector(state() as { user: { id: string } | null })
      ),
      { getState: state }
    ),
  };
});

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
      queries: { retry: false, gcTime: 0 },
    },
  });
}

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

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthUserId.mockReturnValue('auth-user-1');
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'auth-user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'token-123' } },
    error: null,
  });
});

describe('useVTUHistory', () => {
  it('loads utility history for the selected filter', async () => {
    const queryClient = createTestClient();
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        transactions: [
          {
            id: 'tx-1',
            created_at: '2026-04-08T12:00:00.000Z',
            type: 'electricity',
            status: 'successful',
            amount: 2500,
            biller_name: 'EKEDC NG',
            customer_identifier: '1234567890',
            request_reference: 'VTU-123',
            customer_cashback: 0,
            payment_status: 'completed',
          },
          {
            id: 'tx-2',
            created_at: '2026-04-08T12:01:00.000Z',
            type: 'airtime',
            status: 'pending',
            amount: 500,
            phone_number: '08012345678',
            request_reference: 'VTU-124',
            payment_status: 'pending',
          },
          {
            id: 'tx-3',
            created_at: '2026-04-08T12:02:00.000Z',
            type: 'data',
            status: 'failed',
            amount: 1500,
            phone_number: '08012345678',
            request_reference: 'VTU-125',
            payment_status: 'failed',
          },
        ],
      }),
    });

    const { result, unmount } = renderHook(() => useVTUHistory('power'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      expect.objectContaining({
        type: 'electricity',
        biller_name: 'EKEDC NG',
        payment_status: 'completed',
      }),
      expect.objectContaining({
        type: 'airtime',
        status: 'pending',
        payment_status: 'pending',
      }),
      expect.objectContaining({
        type: 'data',
        status: 'failed',
        payment_status: 'failed',
      }),
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/vtu/history?'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      })
    );
    expect(fetchSpy.mock.calls[0]?.[0]).toContain('type=electricity');

    unmount();
    queryClient.clear();
  });

  it('shares one deadline across slow headers and a stalled body', async () => {
    // Codex R70 6ryArL: headers arrive 100ms before the bound and the
    // body never streams — the query must fail at 10s, not ~20s.
    jest.useFakeTimers();
    try {
      const queryClient = createTestClient();
      fetchSpy.mockImplementationOnce(
        () =>
          new Promise<MockFetchResponse>((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: () => new Promise<Record<string, unknown>>(() => {}),
              });
            }, 9900);
          })
      );

      const { result, unmount } = renderHook(() => useVTUHistory('power'), {
        wrapper: createWrapper(queryClient),
      });
      // Flush the query start BEFORE moving the fake clock: the fetch
      // (and its 9.9s headers timer) must be scheduled at T0, or
      // React's scheduler hops shift the deadline mid-advance.
      await act(async () => {});
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/vtu/history?'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      // The deadline fires on the last fake tick; the rejection still
      // needs scheduler turns to reach the rendered error state.
      await waitFor(() => expect(result.current.isError).toBe(true));
      // R72: the stalled fetch was aborted pre-failure.
      const sentSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
      expect(sentSignal?.aborted).toBe(true);

      unmount();
      queryClient.clear();
    } finally {
      jest.useRealTimers();
    }
  });

  it('marks successes stale without deleting them', async () => {
    // Codex R69 6rxZFO: history also mounts hidden (quick-repeat
    // defaults, receipts pager), so a read never proves display —
    // successes mark stale (the retry is told "Already Completed"),
    // suppressed completions are skipped so their replay presents.
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('hist-success', 'key-success');
    notePendingVtuReference('hist-success', 'VTU-123');
    rememberPendingVtuPurchase('hist-pending', 'key-pending');
    notePendingVtuReference('hist-pending', 'VTU-124');
    rememberPendingVtuPurchase('hist-failed', 'key-failed');
    notePendingVtuReference('hist-failed', 'VTU-125');
    rememberPendingVtuPurchase('hist-suppressed', 'key-suppressed');
    notePendingVtuReference('hist-suppressed', 'VTU-126');
    markPendingVtuCompleted('hist-suppressed');
    const queryClient = createTestClient();
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        transactions: [
          {
            id: 'tx-1',
            created_at: '2026-04-08T12:00:00.000Z',
            type: 'electricity',
            status: 'successful',
            amount: 2500,
            request_reference: 'VTU-123',
          },
          {
            id: 'tx-2',
            created_at: '2026-04-08T12:01:00.000Z',
            type: 'airtime',
            status: 'pending',
            amount: 500,
            request_reference: 'VTU-124',
          },
          {
            id: 'tx-3',
            created_at: '2026-04-08T12:02:00.000Z',
            type: 'data',
            status: 'failed',
            amount: 1500,
            request_reference: 'VTU-125',
          },
          {
            id: 'tx-4',
            created_at: '2026-04-08T12:03:00.000Z',
            type: 'airtime',
            status: 'successful',
            amount: 500,
            request_reference: 'VTU-126',
          },
        ],
      }),
    });

    const { result, unmount } = renderHook(() => useVTUHistory('all'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Success marks stale (not deleted); suppressed keeps its fresh
    // mark so the replay presents; pending is untouched; failed keeps
    // backfill-era behavior (no refund proof in this projection).
    expect(recallPendingVtuKey('hist-success')).toBe('key-success');
    expect(isStalePendingVtuSuccess('hist-success', 'VTU-123')).toBe(true);
    expect(recallPendingVtuKey('hist-suppressed')).toBe('key-suppressed');
    expect(isStalePendingVtuSuccess('hist-suppressed', 'VTU-126')).toBe(false);
    expect(recallPendingVtuKey('hist-pending')).toBe('key-pending');
    expect(recallPendingVtuKey('hist-failed')).toBe('key-failed');

    unmount();
    queryClient.clear();
  });

  it('skips settling when the account switches mid-fetch', async () => {
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('hist-switch', 'key-switch');
    notePendingVtuReference('hist-switch', 'VTU-123');
    // getUser (fetch identity) still reports user-1, but the store
    // has moved on — the rows were never shown to the submitter.
    mockAuthUserId.mockReturnValue('auth-user-2');
    const queryClient = createTestClient();
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        transactions: [
          {
            id: 'tx-1',
            created_at: '2026-04-08T12:00:00.000Z',
            type: 'electricity',
            status: 'successful',
            amount: 2500,
            request_reference: 'VTU-123',
          },
        ],
      }),
    });

    const { result, unmount } = renderHook(() => useVTUHistory('all'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(recallPendingVtuKey('hist-switch')).toBe('key-switch');

    unmount();
    queryClient.clear();
  });

  it('surfaces the server error message when the request fails', async () => {
    const queryClient = createTestClient();
    fetchSpy.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'History is unavailable' }),
    });

    const { result, unmount } = renderHook(() => useVTUHistory('all'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(new Error('History is unavailable'));

    unmount();
    queryClient.clear();
  });
});
