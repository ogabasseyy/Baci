import { jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import {
  clearPendingVtuKeys,
  isStalePendingVtuSuccess,
  notePendingVtuReference,
  PENDING_VTU_STALE_AFTER_MS,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from '@/lib/pending-vtu-idempotency';
import {
  FAST_POLL_ATTEMPTS,
  MAX_POLL_ATTEMPTS,
  POLL_INTERVAL_MS,
  POLL_SLOW_INTERVAL_MS,
  useVtuVoucherPinBackfill,
} from './use-vtu-voucher-pin-backfill';

const mockGetSession =
  jest.fn<
    () => Promise<{
      data: { session: null | { access_token: string } };
      error: null | { message: string };
    }>
  >();
const mockFetchWithTimeout =
  jest.fn<(url: string, options: RequestInit) => Promise<Response>>();
const mockUseAuthStore = jest.fn<() => string | null>();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession() },
  },
}));

jest.mock('@/lib/fetch-with-timeout', () => ({
  fetchWithTimeout: (url: string, options: RequestInit) =>
    mockFetchWithTimeout(url, options),
  SHORT_TIMEOUT: 5000,
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: { user?: { id: string } | null }) => string | null
  ) => {
    const id = mockUseAuthStore();
    return selector(id ? { user: { id } } : { user: null });
  },
}));

jest.mock('@/env', () => ({ EXPO_PUBLIC_API_URL: 'http://localhost:3001' }));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_SLUG: 'test-merchant' },
}));

function makeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: jest.fn<() => Promise<unknown>>().mockResolvedValue(body),
  } as unknown as Response;
}

// One stable QueryClient per test — avoids multiple instances in React 19
// Strict Mode which double-invokes the wrapper and can create orphaned clients.
let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    children
  );
}

const BASE_INPUT = {
  enabled: true,
  reference: 'REF-001',
  utilityType: 'power' as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  clearPendingVtuKeys();
  jest.useFakeTimers();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
  mockUseAuthStore.mockReturnValue('user-1');
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'tok' } },
    error: null,
  });
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('useVtuVoucherPinBackfill', () => {
  it('returns the voucher pin once the poll finds a match', async () => {
    mockFetchWithTimeout.mockResolvedValue(
      makeResponse({
        transactions: [
          { request_reference: 'REF-001', voucher_pin: '1234-5678' },
        ],
      })
    );

    const { result } = renderHook(() => useVtuVoucherPinBackfill(BASE_INPUT), {
      wrapper,
    });

    await waitFor(() => expect(result.current.pin).toBe('1234-5678'));
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('polls up to MAX_POLL_ATTEMPTS then stops', async () => {
    mockFetchWithTimeout.mockResolvedValue(
      makeResponse({
        transactions: [{ request_reference: 'REF-001', voucher_pin: null }],
      })
    );

    const { result } = renderHook(() => useVtuVoucherPinBackfill(BASE_INPUT), {
      wrapper,
    });

    // Drain initial fetch, then one interval per remaining attempt:
    // fast phase first, slow phase after.
    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));
    for (let i = 1; i < FAST_POLL_ATTEMPTS; i++) {
      await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      await waitFor(() =>
        expect(mockFetchWithTimeout).toHaveBeenCalledTimes(i + 1)
      );
    }
    for (let i = FAST_POLL_ATTEMPTS; i < MAX_POLL_ATTEMPTS; i++) {
      await jest.advanceTimersByTimeAsync(POLL_SLOW_INTERVAL_MS);
      await waitFor(() =>
        expect(mockFetchWithTimeout).toHaveBeenCalledTimes(i + 1)
      );
    }

    // Advance two more slow intervals — cap must prevent more fetches.
    await jest.advanceTimersByTimeAsync(POLL_SLOW_INTERVAL_MS * 2);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(MAX_POLL_ATTEMPTS);
    expect(result.current).toEqual({ pin: null, status: null });
  });

  it('backs off to the slow interval after the fast attempts', async () => {
    mockFetchWithTimeout.mockResolvedValue(
      makeResponse({
        transactions: [{ request_reference: 'REF-001', voucher_pin: null }],
      })
    );

    renderHook(() => useVtuVoucherPinBackfill(BASE_INPUT), { wrapper });

    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));
    for (let i = 1; i <= FAST_POLL_ATTEMPTS; i++) {
      await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      await waitFor(() =>
        expect(mockFetchWithTimeout).toHaveBeenCalledTimes(i + 1)
      );
    }
    // Past the fast window a short advance fetches nothing...
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(FAST_POLL_ATTEMPTS + 1);
    // ...while a full slow interval fires the next attempt.
    await jest.advanceTimersByTimeAsync(
      POLL_SLOW_INTERVAL_MS - POLL_INTERVAL_MS
    );
    await waitFor(() =>
      expect(mockFetchWithTimeout).toHaveBeenCalledTimes(FAST_POLL_ATTEMPTS + 2)
    );
  });

  it('returns null and does not fetch when enabled is false', () => {
    const { result } = renderHook(
      () => useVtuVoucherPinBackfill({ ...BASE_INPUT, enabled: false }),
      { wrapper }
    );

    expect(result.current).toEqual({ pin: null, status: null });
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('returns null immediately when apiType is null (unsupported utility type)', () => {
    const { result } = renderHook(
      () =>
        useVtuVoucherPinBackfill({
          ...BASE_INPUT,
          utilityType: 'unknown-type' as never,
        }),
      { wrapper }
    );

    expect(result.current).toEqual({ pin: null, status: null });
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('polls telco types for settlement and marks the retained entry', async () => {
    rememberPendingVtuPurchase('hook-telco', 'key-hook-telco');
    notePendingVtuReference('hook-telco', 'REF-001');
    mockFetchWithTimeout.mockResolvedValue(
      makeResponse({
        transactions: [
          {
            request_reference: 'REF-001',
            voucher_pin: null,
            status: 'successful',
          },
        ],
      })
    );

    const { result } = renderHook(
      () => useVtuVoucherPinBackfill({ ...BASE_INPUT, utilityType: 'airtime' }),
      { wrapper }
    );

    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));
    // Terminal observation stops the loop (no pin expected for telco).
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ pin: null, status: 'successful' });
    // ...and settles the registry so the stale guard can fire later.
    expect(isStalePendingVtuSuccess('hook-telco', 'REF-001')).toBe(false);
    expect(
      isStalePendingVtuSuccess(
        'hook-telco',
        'REF-001',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
  });

  it('forgets the retained entry when history reports failure', async () => {
    rememberPendingVtuPurchase('hook-fail', 'key-hook-fail');
    notePendingVtuReference('hook-fail', 'REF-001');
    mockFetchWithTimeout.mockResolvedValue(
      makeResponse({
        transactions: [
          {
            request_reference: 'REF-001',
            voucher_pin: null,
            status: 'failed',
            refund_pending: false,
          },
        ],
      })
    );

    const { result } = renderHook(() => useVtuVoucherPinBackfill(BASE_INPUT), {
      wrapper,
    });

    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ pin: null, status: 'failed' });
    expect(recallPendingVtuKey('hook-fail')).toBeNull();
  });

  it('waits for refund confirmation before settling a failure', async () => {
    rememberPendingVtuPurchase('hook-failpend', 'key-hook-failpend');
    notePendingVtuReference('hook-failpend', 'REF-001');
    mockFetchWithTimeout.mockResolvedValue(
      makeResponse({
        transactions: [
          {
            request_reference: 'REF-001',
            voucher_pin: null,
            status: 'failed',
            refund_pending: true,
          },
        ],
      })
    );

    const { result } = renderHook(() => useVtuVoucherPinBackfill(BASE_INPUT), {
      wrapper,
    });

    // Unconfirmed failure is non-terminal: keep polling, no settle.
    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(2));
    expect(result.current).toEqual({ pin: null, status: null });
    expect(recallPendingVtuKey('hook-failpend')).toBe('key-hook-failpend');
  });

  it('keeps hunting a token for pin-less bill successes', async () => {
    rememberPendingVtuPurchase('hook-token', 'key-hook-token');
    notePendingVtuReference('hook-token', 'REF-001');
    mockFetchWithTimeout.mockResolvedValue(
      makeResponse({
        transactions: [
          {
            request_reference: 'REF-001',
            voucher_pin: null,
            status: 'successful',
          },
        ],
      })
    );

    const { result } = renderHook(
      () => useVtuVoucherPinBackfill({ ...BASE_INPUT, utilityType: 'power' }),
      { wrapper }
    );

    // Success settles the registry and reports immediately...
    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(result.current).toEqual({ pin: null, status: 'successful' })
    );
    expect(
      isStalePendingVtuSuccess(
        'hook-token',
        'REF-001',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
    // ...but the pin hunt continues while a token may still arrive.
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(2));
  });

  it('keeps polling while history reports a non-terminal status', async () => {
    rememberPendingVtuPurchase('hook-proc', 'key-hook-proc');
    notePendingVtuReference('hook-proc', 'REF-001');
    mockFetchWithTimeout.mockResolvedValue(
      makeResponse({
        transactions: [
          {
            request_reference: 'REF-001',
            voucher_pin: null,
            status: 'processing',
          },
        ],
      })
    );

    renderHook(() => useVtuVoucherPinBackfill(BASE_INPUT), { wrapper });

    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(2));
    // Non-terminal: the retained entry is untouched.
    expect(
      isStalePendingVtuSuccess(
        'hook-proc',
        'REF-001',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(false);
  });

  it('returns null immediately when userId is absent (unauthenticated)', () => {
    mockUseAuthStore.mockReturnValue(null);

    const { result } = renderHook(() => useVtuVoucherPinBackfill(BASE_INPUT), {
      wrapper,
    });

    expect(result.current).toEqual({ pin: null, status: null });
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('returns null and skips fetch when getSession returns an error', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'Auth error' },
    });

    const { result } = renderHook(() => useVtuVoucherPinBackfill(BASE_INPUT), {
      wrapper,
    });

    await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(1));
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
    expect(result.current).toEqual({ pin: null, status: null });
  });

  it('halts polling immediately on a non-retriable HTTP error', async () => {
    mockFetchWithTimeout.mockResolvedValue(makeResponse({}, false, 401));

    const { result } = renderHook(() => useVtuVoucherPinBackfill(BASE_INPUT), {
      wrapper,
    });

    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));

    // Two more intervals must not trigger additional fetches
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ pin: null, status: null });
  });

  it('retries transient 5xx responses within the attempt budget', async () => {
    mockFetchWithTimeout
      .mockResolvedValueOnce(makeResponse({}, false, 503))
      .mockResolvedValue(
        makeResponse({
          transactions: [
            {
              request_reference: 'REF-001',
              voucher_pin: '1234-5678',
              status: 'successful',
            },
          ],
        })
      );

    const { result } = renderHook(() => useVtuVoucherPinBackfill(BASE_INPUT), {
      wrapper,
    });

    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.current).toEqual({ pin: '1234-5678', status: 'successful' })
    );
  });

  it('retries 429 responses within the attempt budget', async () => {
    mockFetchWithTimeout
      .mockResolvedValueOnce(makeResponse({}, false, 429))
      .mockResolvedValue(
        makeResponse({
          transactions: [{ request_reference: 'REF-001', voucher_pin: null }],
        })
      );

    renderHook(() => useVtuVoucherPinBackfill(BASE_INPUT), { wrapper });

    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(2));
  });

  it('retries when fetchWithTimeout rejects (network/timeout)', async () => {
    mockFetchWithTimeout
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValue(
        makeResponse({
          transactions: [{ request_reference: 'REF-001', voucher_pin: null }],
        })
      );

    const { result } = renderHook(() => useVtuVoucherPinBackfill(BASE_INPUT), {
      wrapper,
    });

    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(2));
    expect(result.current).toEqual({ pin: null, status: null });
  });

  it('retries when response.json() throws', async () => {
    mockFetchWithTimeout
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest
          .fn<() => Promise<unknown>>()
          .mockRejectedValue(new Error('Invalid JSON')),
      } as unknown as Response)
      .mockResolvedValue(
        makeResponse({
          transactions: [{ request_reference: 'REF-001', voucher_pin: null }],
        })
      );

    const { result } = renderHook(() => useVtuVoucherPinBackfill(BASE_INPUT), {
      wrapper,
    });

    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(2));
    expect(result.current).toEqual({ pin: null, status: null });
  });

  it('halts polling immediately when response schema does not match', async () => {
    mockFetchWithTimeout.mockResolvedValue(makeResponse({ unexpected: true }));

    const { result } = renderHook(() => useVtuVoucherPinBackfill(BASE_INPUT), {
      wrapper,
    });

    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));

    // Schema mismatch now throws → error state → polling stops
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ pin: null, status: null });
  });
});
