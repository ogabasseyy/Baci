import { jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import {
  clearPendingVtuKeys,
  notePendingVtuReference,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from '@/lib/pending-vtu-idempotency';
import { useVtuRetainedSettlement } from './use-vtu-retained-settlement';

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

jest.mock('@/stores/auth-store', () => {
  const hook = Object.assign(
    (selector: (state: { user?: { id: string } | null }) => string | null) => {
      const id = mockUseAuthStore();
      return selector(id ? { user: { id } } : { user: null });
    },
    {
      getState: () => {
        const id = mockUseAuthStore();
        return id ? { user: { id } } : { user: null };
      },
    }
  );
  return { useAuthStore: hook };
});

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

describe('useVtuRetainedSettlement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPendingVtuKeys();
    mockUseAuthStore.mockReturnValue('user-1');
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'token' } },
      error: null,
    });
  });

  it('settles retained references with direct reference-scoped reads', async () => {
    // Codex R57 6rsvy7: capped history pages can miss a settled row,
    // so each retained reference is queried directly (web parity).
    rememberPendingVtuPurchase('mob-settle', 'key-settle');
    notePendingVtuReference('mob-settle', 'REF-SETTLED');
    mockFetchWithTimeout.mockResolvedValue(
      makeResponse({
        transactions: [
          {
            request_reference: 'REF-SETTLED',
            status: 'successful',
            refund_pending: false,
          },
        ],
      })
    );

    renderHook(() => useVtuRetainedSettlement({ enabled: true }));

    await waitFor(() => expect(recallPendingVtuKey('mob-settle')).toBeNull());
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
    const url = String(mockFetchWithTimeout.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('reference=REF-SETTLED');
    expect(url).not.toContain('type=');
  });

  it('stays idle without references, session, or enablement', async () => {
    rememberPendingVtuPurchase('mob-idle', 'key-idle');
    notePendingVtuReference('mob-idle', 'REF-IDLE');

    const { unmount: unmountDisabled } = renderHook(() =>
      useVtuRetainedSettlement({ enabled: false })
    );
    mockUseAuthStore.mockReturnValue(null);
    const { unmount: unmountUnsigned } = renderHook(() =>
      useVtuRetainedSettlement({ enabled: true })
    );
    mockUseAuthStore.mockReturnValue('user-1');
    clearPendingVtuKeys();
    const { unmount: unmountEmpty } = renderHook(() =>
      useVtuRetainedSettlement({ enabled: true })
    );
    await waitFor(() => expect(mockFetchWithTimeout).not.toHaveBeenCalled());

    unmountDisabled();
    unmountUnsigned();
    unmountEmpty();
  });

  it('leaves entries untouched when the read fails', async () => {
    rememberPendingVtuPurchase('mob-flaky', 'key-flaky');
    notePendingVtuReference('mob-flaky', 'REF-FLAKY');
    mockFetchWithTimeout.mockResolvedValue(makeResponse({}, false, 500));

    renderHook(() => useVtuRetainedSettlement({ enabled: true }));

    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));
    // Fail-open: the replay path still dedupes.
    expect(recallPendingVtuKey('mob-flaky')).toBe('key-flaky');
  });

  it('skips settling when the account switches mid-read', async () => {
    rememberPendingVtuPurchase('mob-switch', 'key-switch');
    notePendingVtuReference('mob-switch', 'REF-SWITCH');
    let currentUser: string | null = 'user-1';
    mockUseAuthStore.mockImplementation(() => currentUser);
    let release!: (value: unknown) => void;
    const gate = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => gate,
    } as unknown as Response);

    renderHook(() => useVtuRetainedSettlement({ enabled: true }));
    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1));

    // Switch before the read resolves: the guard inside
    // fetchVoucherPin must skip the forget.
    currentUser = 'user-2';
    release({
      transactions: [
        {
          request_reference: 'REF-SWITCH',
          status: 'successful',
          refund_pending: false,
        },
      ],
    });
    await gate;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(recallPendingVtuKey('mob-switch')).toBe('key-switch');
  });
});
