import { jest } from '@jest/globals';
import {
  clearPendingVtuKeys,
  isStalePendingVtuSuccess,
  markPendingVtuCompleted,
  notePendingVtuReference,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from '@/lib/pending-vtu-idempotency';
import { fetchVoucherPin } from './use-vtu-voucher-pin-backfill-fetch';

const mockGetSession =
  jest.fn<
    () => Promise<{
      data: { session: null | { access_token: string } };
      error: null | { message: string };
    }>
  >();
// Real shared helper under test (R72): global fetch is the seam.
const fetchSpy = jest.spyOn(global, 'fetch');
const mockCurrentUserId: { value: string | null } = { value: 'user-1' };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession() },
  },
}));

jest.mock('@/lib/fetch-with-timeout', () => ({
  SHORT_TIMEOUT: 5000,
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      user: mockCurrentUserId.value ? { id: mockCurrentUserId.value } : null,
    }),
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

function successBody(pin: string | null = 'PIN-1') {
  return {
    transactions: [
      {
        request_reference: 'REF-1',
        status: 'successful',
        voucher_pin: pin,
        refund_pending: false,
      },
    ],
  };
}

const input = {
  apiType: 'electricity' as const,
  capturedUserId: 'user-1',
  isViewActive: () => true,
  reference: 'REF-1',
};

describe('fetchVoucherPin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPendingVtuKeys();
    mockCurrentUserId.value = 'user-1';
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'token' } },
      error: null,
    });
  });

  it('returns null without a session and skips the fetch', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(fetchVoucherPin(input)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a blank observation on transient failures', async () => {
    // Network throw, 5xx, 429, and unparseable bodies all consume
    // the attempt but keep polling (Codex R64 6rucqk).
    fetchSpy.mockRejectedValueOnce(new Error('down'));
    await expect(fetchVoucherPin(input)).resolves.toEqual({
      pin: null,
      status: null,
      refundPending: null,
    });

    fetchSpy.mockResolvedValueOnce(makeResponse({}, false, 503));
    await expect(fetchVoucherPin(input)).resolves.toEqual({
      pin: null,
      status: null,
      refundPending: null,
    });

    fetchSpy.mockResolvedValueOnce(makeResponse({}, false, 429));
    await expect(fetchVoucherPin(input)).resolves.toEqual({
      pin: null,
      status: null,
      refundPending: null,
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest
        .fn<() => Promise<unknown>>()
        .mockRejectedValue(new Error('bad')),
    } as unknown as Response);
    await expect(fetchVoucherPin(input)).resolves.toEqual({
      pin: null,
      status: null,
      refundPending: null,
    });
  });

  it('throws on permanent failures to halt polling', async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse({}, false, 401));
    await expect(fetchVoucherPin(input)).rejects.toThrow(
      'VTU history fetch failed: 401'
    );

    fetchSpy.mockResolvedValueOnce(makeResponse({ nope: 1 }));
    await expect(fetchVoucherPin(input)).rejects.toThrow(
      'VTU history response schema mismatch'
    );
  });

  it('returns the observation and forgets on shown terminal success', async () => {
    rememberPendingVtuPurchase('fetch-1', 'key-1');
    notePendingVtuReference('fetch-1', 'REF-1');
    fetchSpy.mockResolvedValueOnce(makeResponse(successBody()));

    const observation = await fetchVoucherPin(input);

    expect(observation).toEqual({
      pin: 'PIN-1',
      status: 'successful',
      refundPending: false,
    });
    expect(recallPendingVtuKey('fetch-1')).toBeNull();
  });

  it('forgets refund-confirmed failures but not pending ones', async () => {
    rememberPendingVtuPurchase('fetch-done', 'key-done');
    notePendingVtuReference('fetch-done', 'REF-1');
    fetchSpy.mockResolvedValueOnce(
      makeResponse({
        transactions: [
          {
            request_reference: 'REF-1',
            status: 'failed',
            refund_pending: false,
          },
        ],
      })
    );

    await fetchVoucherPin(input);
    expect(recallPendingVtuKey('fetch-done')).toBeNull();

    rememberPendingVtuPurchase('fetch-open', 'key-open');
    notePendingVtuReference('fetch-open', 'REF-1');
    fetchSpy.mockResolvedValueOnce(
      makeResponse({
        transactions: [
          {
            request_reference: 'REF-1',
            status: 'failed',
            refund_pending: true,
          },
        ],
      })
    );

    const observation = await fetchVoucherPin(input);
    expect(observation?.status).toBe('failed');
    expect(recallPendingVtuKey('fetch-open')).toBe('key-open');
  });

  it('marks successes stale in background-settle mode without deleting', async () => {
    // Codex R68 6rwG9F: the settlement pass observes terminality for
    // results nobody saw — the retry must be told "Already Completed".
    rememberPendingVtuPurchase('fetch-bg', 'key-bg');
    notePendingVtuReference('fetch-bg', 'REF-1');
    fetchSpy.mockResolvedValueOnce(makeResponse(successBody()));

    const observation = await fetchVoucherPin({
      ...input,
      backgroundSettle: true,
    });

    expect(observation?.status).toBe('successful');
    expect(recallPendingVtuKey('fetch-bg')).toBe('key-bg');
    expect(isStalePendingVtuSuccess('fetch-bg', 'REF-1')).toBe(true);
  });

  it('skips suppressed completions in background-settle mode', async () => {
    rememberPendingVtuPurchase('fetch-bg-suppressed', 'key-bg-suppressed');
    notePendingVtuReference('fetch-bg-suppressed', 'REF-1');
    markPendingVtuCompleted('fetch-bg-suppressed');
    fetchSpy.mockResolvedValueOnce(makeResponse(successBody()));

    await fetchVoucherPin({ ...input, backgroundSettle: true });

    expect(recallPendingVtuKey('fetch-bg-suppressed')).toBe(
      'key-bg-suppressed'
    );
    expect(isStalePendingVtuSuccess('fetch-bg-suppressed', 'REF-1')).toBe(
      false
    );
  });

  it('still forgets refund-confirmed failures in background-settle mode', async () => {
    // Nothing was delivered: the retry is correctly a fresh charge.
    rememberPendingVtuPurchase('fetch-bg-fail', 'key-bg-fail');
    notePendingVtuReference('fetch-bg-fail', 'REF-1');
    fetchSpy.mockResolvedValueOnce(
      makeResponse({
        transactions: [
          {
            request_reference: 'REF-1',
            status: 'failed',
            refund_pending: false,
          },
        ],
      })
    );

    await fetchVoucherPin({ ...input, backgroundSettle: true });

    expect(recallPendingVtuKey('fetch-bg-fail')).toBeNull();
  });

  it('returns blank when the response body stalls past the bound', async () => {
    // Codex R68 6rwg9A: headers arrived but the body never streams.
    jest.useFakeTimers();
    try {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => new Promise(() => {}),
      } as unknown as Response);

      const pending = fetchVoucherPin(input);
      await jest.advanceTimersByTimeAsync(5000);

      await expect(pending).resolves.toEqual({
        pin: null,
        status: null,
        refundPending: null,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('shares one deadline across slow headers and a stalled body', async () => {
    // Codex R70 6ryArL: headers arrive 100ms before the bound and the
    // body never streams — the body must share the REMAINDER, not
    // restart the clock (blank at 5s, not ~10s).
    jest.useFakeTimers();
    try {
      fetchSpy.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                status: 200,
                json: () => new Promise(() => {}),
              } as unknown as Response);
            }, 4900);
          })
      );

      const pending = fetchVoucherPin(input);
      await jest.advanceTimersByTimeAsync(5000);

      await expect(pending).resolves.toEqual({
        pin: null,
        status: null,
        refundPending: null,
      });
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/vtu/history?'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      // R72: the stalled fetch was aborted pre-blank.
      const sentSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
      expect(sentSignal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('never forgets across an account switch or after unmount', async () => {
    rememberPendingVtuPurchase('fetch-switched', 'key-switched');
    notePendingVtuReference('fetch-switched', 'REF-1');
    fetchSpy.mockResolvedValue(makeResponse(successBody()));

    mockCurrentUserId.value = 'user-2';
    const switched = await fetchVoucherPin(input);
    expect(switched?.status).toBe('successful');
    expect(recallPendingVtuKey('fetch-switched')).toBe('key-switched');

    mockCurrentUserId.value = 'user-1';
    const unmounted = await fetchVoucherPin({
      ...input,
      isViewActive: () => false,
    });
    expect(unmounted?.status).toBe('successful');
    expect(recallPendingVtuKey('fetch-switched')).toBe('key-switched');
  });

  it('returns nulls without forgetting when the row is missing', async () => {
    rememberPendingVtuPurchase('fetch-missing', 'key-missing');
    notePendingVtuReference('fetch-missing', 'REF-1');
    fetchSpy.mockResolvedValueOnce(makeResponse({ transactions: [] }));

    const observation = await fetchVoucherPin(input);

    expect(observation).toEqual({
      pin: null,
      status: null,
      refundPending: null,
    });
    expect(recallPendingVtuKey('fetch-missing')).toBe('key-missing');
  });
});
