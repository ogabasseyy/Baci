import { jest } from '@jest/globals';
import {
  clearPendingVtuKeys,
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
const mockFetchWithTimeout =
  jest.fn<(url: string, options: RequestInit) => Promise<Response>>();
const mockCurrentUserId: { value: string | null } = { value: 'user-1' };

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
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('returns a blank observation on transient failures', async () => {
    // Network throw, 5xx, 429, and unparseable bodies all consume
    // the attempt but keep polling (Codex R64 6rucqk).
    mockFetchWithTimeout.mockRejectedValueOnce(new Error('down'));
    await expect(fetchVoucherPin(input)).resolves.toEqual({
      pin: null,
      status: null,
      refundPending: null,
    });

    mockFetchWithTimeout.mockResolvedValueOnce(makeResponse({}, false, 503));
    await expect(fetchVoucherPin(input)).resolves.toEqual({
      pin: null,
      status: null,
      refundPending: null,
    });

    mockFetchWithTimeout.mockResolvedValueOnce(makeResponse({}, false, 429));
    await expect(fetchVoucherPin(input)).resolves.toEqual({
      pin: null,
      status: null,
      refundPending: null,
    });

    mockFetchWithTimeout.mockResolvedValueOnce({
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
    mockFetchWithTimeout.mockResolvedValueOnce(makeResponse({}, false, 401));
    await expect(fetchVoucherPin(input)).rejects.toThrow(
      'VTU history fetch failed: 401'
    );

    mockFetchWithTimeout.mockResolvedValueOnce(makeResponse({ nope: 1 }));
    await expect(fetchVoucherPin(input)).rejects.toThrow(
      'VTU history response schema mismatch'
    );
  });

  it('returns the observation and forgets on shown terminal success', async () => {
    rememberPendingVtuPurchase('fetch-1', 'key-1');
    notePendingVtuReference('fetch-1', 'REF-1');
    mockFetchWithTimeout.mockResolvedValueOnce(makeResponse(successBody()));

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
    mockFetchWithTimeout.mockResolvedValueOnce(
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
    mockFetchWithTimeout.mockResolvedValueOnce(
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

  it('never forgets across an account switch or after unmount', async () => {
    rememberPendingVtuPurchase('fetch-switched', 'key-switched');
    notePendingVtuReference('fetch-switched', 'REF-1');
    mockFetchWithTimeout.mockResolvedValue(makeResponse(successBody()));

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
    mockFetchWithTimeout.mockResolvedValueOnce(
      makeResponse({ transactions: [] })
    );

    const observation = await fetchVoucherPin(input);

    expect(observation).toEqual({
      pin: null,
      status: null,
      refundPending: null,
    });
    expect(recallPendingVtuKey('fetch-missing')).toBe('key-missing');
  });
});
