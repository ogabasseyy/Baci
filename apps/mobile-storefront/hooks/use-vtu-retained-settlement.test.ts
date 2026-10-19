import { buildPendingVtuScopeTag } from '@baci/shared';
import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  clearPendingVtuKeys,
  isStalePendingVtuSuccess,
  markPendingVtuCompleted,
  notePendingVtuReference,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from '@/lib/pending-vtu-idempotency';
import {
  getPendingVtuSettlementPass,
  useVtuRetainedSettlement,
} from './use-vtu-retained-settlement';

const mockGetSession =
  jest.fn<
    () => Promise<{
      data: { session: null | { access_token: string } };
      error: null | { message: string };
    }>
  >();
// Real shared helper under test (R72): global fetch is the seam.
const fetchSpy = jest.spyOn(global, 'fetch');
const mockUseAuthStore = jest.fn<() => string | null>();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession() },
  },
}));

jest.mock('@/lib/fetch-with-timeout', () => ({
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
  CONFIG: { MERCHANT_SLUG: 'test-merchant', MERCHANT_ID: 'test-merchant-id' },
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

  it('marks terminal successes stale without deleting them', async () => {
    // Codex R68 6rwG9F: the outcome was never shown in-session, so
    // the retry must be told "Already Completed" — not silently
    // double-charge on a fresh key.
    rememberPendingVtuPurchase('mob-settle', 'key-settle');
    notePendingVtuReference('mob-settle', 'REF-SETTLED');
    fetchSpy.mockResolvedValue(
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

    await waitFor(() =>
      expect(isStalePendingVtuSuccess('mob-settle', 'REF-SETTLED')).toBe(true)
    );
    expect(recallPendingVtuKey('mob-settle')).toBe('key-settle');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('reference=REF-SETTLED');
    expect(url).not.toContain('type=');
  });

  it('skips suppressed completions so their replay presents', async () => {
    // Codex R68 6rwG9F: the terminal result was never shown — the
    // pass must not delete it; the retry replays the unseen outcome
    // instead of minting fresh and debiting twice. Since R115 the
    // reference list excludes completed entries (markSettled was a
    // no-op for them), so the pass never fetches — same outcome,
    // fewer reads; the replay still presents via the stale guard
    // (web mirror; this mobile copy kept the stale fetch
    // expectation and timed out from R115 until R152).
    rememberPendingVtuPurchase('mob-suppressed', 'key-suppressed');
    notePendingVtuReference('mob-suppressed', 'REF-SUPPRESSED');
    markPendingVtuCompleted('mob-suppressed');

    renderHook(() => useVtuRetainedSettlement({ enabled: true }));
    // Flush effects: the no-fetch assertion is only meaningful
    // once the pass has had its chance to run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getPendingVtuSettlementPass()).toBeNull();
    expect(recallPendingVtuKey('mob-suppressed')).toBe('key-suppressed');
    expect(isStalePendingVtuSuccess('mob-suppressed', 'REF-SUPPRESSED')).toBe(
      false
    );
  });

  it('skips references tagged to another owner', async () => {
    // Codex R62 6rtokd: the registry survives switches by design —
    // the pass must only read the active account's references.
    const mine = buildPendingVtuScopeTag('user-1', 'test-merchant-id');
    const theirs = buildPendingVtuScopeTag('user-2', 'test-merchant-id');
    rememberPendingVtuPurchase('mob-mine', 'key-mine', mine);
    notePendingVtuReference('mob-mine', 'REF-MINE');
    rememberPendingVtuPurchase('mob-theirs', 'key-theirs', theirs);
    notePendingVtuReference('mob-theirs', 'REF-THEIRS');
    fetchSpy.mockResolvedValue(makeResponse({ transactions: [] }));

    renderHook(() => useVtuRetainedSettlement({ enabled: true }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const url = String(fetchSpy.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('reference=REF-MINE');
    expect(recallPendingVtuKey('mob-theirs')).toBe('key-theirs');
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
    await waitFor(() => expect(fetchSpy).not.toHaveBeenCalled());

    unmountDisabled();
    unmountUnsigned();
    unmountEmpty();
  });

  it('leaves entries untouched when the read fails', async () => {
    rememberPendingVtuPurchase('mob-flaky', 'key-flaky');
    notePendingVtuReference('mob-flaky', 'REF-FLAKY');
    fetchSpy.mockResolvedValue(makeResponse({}, false, 500));

    renderHook(() => useVtuRetainedSettlement({ enabled: true }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
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
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => gate,
    } as unknown as Response);

    renderHook(() => useVtuRetainedSettlement({ enabled: true }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

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

  it('exposes the in-flight pass for the settle-then-submit gate', async () => {
    // Codex R60 6rs7PV: submits branch on this — non-null while the
    // pass runs, null once it lands (and when idle).
    rememberPendingVtuPurchase('mob-gate', 'key-gate');
    notePendingVtuReference('mob-gate', 'REF-GATE');
    let release!: (value: unknown) => void;
    const gate = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => gate,
    } as unknown as Response);

    expect(getPendingVtuSettlementPass()).toBeNull();
    renderHook(() => useVtuRetainedSettlement({ enabled: true }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const pass = getPendingVtuSettlementPass();
    expect(pass).toBeInstanceOf(Promise);

    release({
      transactions: [
        {
          request_reference: 'REF-GATE',
          status: 'successful',
          refund_pending: false,
        },
      ],
    });
    await pass;

    expect(recallPendingVtuKey('mob-gate')).toBe('key-gate');
    expect(isStalePendingVtuSuccess('mob-gate', 'REF-GATE')).toBe(true);
    expect(getPendingVtuSettlementPass()).toBeNull();
  });

  it('reports no pass when idle', async () => {
    renderHook(() => useVtuRetainedSettlement({ enabled: true }));

    expect(getPendingVtuSettlementPass()).toBeNull();
  });

  it('detaches the active pass when the account switches mid-pass', async () => {
    // Codex R67 6rwGM5: cleanup must not leave the new owner's submits
    // awaiting the previous account's in-flight read until its timeout.
    // The entry is tagged to user-1, so user-2's effect installs no
    // replacement pass — only the detach clears the stale one.
    rememberPendingVtuPurchase(
      'mob-detach',
      'key-detach',
      buildPendingVtuScopeTag('user-1', 'test-merchant-id')
    );
    notePendingVtuReference('mob-detach', 'REF-DETACH');
    let releaseFetch!: (value: Response) => void;
    const fetchGate = new Promise<Response>((resolve) => {
      releaseFetch = resolve;
    });
    fetchSpy.mockReturnValueOnce(fetchGate);

    const { rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useVtuRetainedSettlement({ enabled }),
      { initialProps: { enabled: true } }
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(getPendingVtuSettlementPass()).not.toBeNull();

    mockUseAuthStore.mockReturnValue('user-2');
    rerender({ enabled: true });
    await waitFor(() => expect(getPendingVtuSettlementPass()).toBeNull());

    // The orphaned read still runs out (fail-open, forgets nothing).
    releaseFetch(makeResponse({ transactions: [] }));
    await fetchGate;
    unmount();
  });
});
