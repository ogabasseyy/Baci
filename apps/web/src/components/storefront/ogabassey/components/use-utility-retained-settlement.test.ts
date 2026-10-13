import { act, renderHook } from '@testing-library/react';
import { buildPendingVtuScopeTag } from '@baci/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingVtuKeys,
  isStalePendingVtuSuccess,
  markPendingVtuCompleted,
  notePendingVtuReference,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from './utility-pending-idempotency';
import {
  getPendingVtuSettlementPass,
  useUtilityRetainedSettlement,
} from './use-utility-retained-settlement';

function mockHistory(impl: (url: string) => unknown) {
  return vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => impl(url),
  }));
}

const input = {
  enabled: true,
  merchantSlug: 'ogabassey',
  scopeMerchantId: 'merchant-1',
  scopeOwnerId: 'user-1',
  userId: 'user-1',
};

describe('useUtilityRetainedSettlement', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks terminal successes stale without deleting them', async () => {
    // Codex R68 6rwG9F: the outcome was never shown in-session (a
    // watched resolution is forgotten by the backfill first), so the
    // retry must be told "Already Completed" — not silently
    // double-charge on a fresh key.
    rememberPendingVtuPurchase('{"settle":true}', 'key-settle');
    notePendingVtuReference('{"settle":true}', 'VTU-SETTLED');
    const fetchMock = mockHistory(() => ({
      transactions: [
        {
          request_reference: 'VTU-SETTLED',
          status: 'successful',
          refund_pending: false,
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useUtilityRetainedSettlement(input));
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toContain(
      'reference=VTU-SETTLED'
    );
    expect(recallPendingVtuKey('{"settle":true}')).toBe('key-settle');
    expect(isStalePendingVtuSuccess('{"settle":true}', 'VTU-SETTLED')).toBe(
      true
    );
  });

  it('skips suppressed completions so their replay presents', async () => {
    // Codex R68 6rwG9F: the terminal result was never shown — the
    // pass must not delete it; the retry replays the unseen outcome
    // instead of minting fresh and debiting twice.
    rememberPendingVtuPurchase('{"suppressed":true}', 'key-suppressed');
    notePendingVtuReference('{"suppressed":true}', 'VTU-SUPPRESSED');
    markPendingVtuCompleted('{"suppressed":true}');
    const fetchMock = mockHistory(() => ({
      transactions: [
        {
          request_reference: 'VTU-SUPPRESSED',
          status: 'successful',
          refund_pending: false,
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useUtilityRetainedSettlement(input));
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(recallPendingVtuKey('{"suppressed":true}')).toBe('key-suppressed');
    expect(
      isStalePendingVtuSuccess('{"suppressed":true}', 'VTU-SUPPRESSED')
    ).toBe(false);
  });

  it('fails open when the response body stalls', async () => {
    // Codex R68 6rwg9A: headers arrive but the body never streams —
    // the pass must resolve after the bound, not gate submits forever.
    // Codex R70 6ryArL: headers arrive 100ms before the bound — the
    // body shares the REMAINDER, so the pass still resolves at 10s.
    vi.useFakeTimers();
    try {
      rememberPendingVtuPurchase('{"stall":true}', 'key-stall');
      notePendingVtuReference('{"stall":true}', 'VTU-STALL');
      const cancelBody = vi.fn(async () => {});
      const fetchMock = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10_000 - 100));
        return {
          ok: true,
          status: 200,
          json: () => new Promise(() => {}),
          body: { cancel: cancelBody },
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      renderHook(() => useUtilityRetainedSettlement(input));
      await act(async () => {});
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getPendingVtuSettlementPass()).not.toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(getPendingVtuSettlementPass()).toBeNull();
      expect(recallPendingVtuKey('{"stall":true}')).toBe('key-stall');
      // R71: the stalled stream was cancelled before the fail-open.
      expect(cancelBody).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles without AbortSignal.any/.timeout (safari 15.4 floor)', async () => {
    // Codex R66 6rvh_R: same guarantee as the backfill — the pass
    // must never touch the unsupported APIs.
    const abortSignalStatics = AbortSignal as unknown as Record<
      string,
      unknown
    >;
    const realAny = abortSignalStatics.any;
    const realTimeout = abortSignalStatics.timeout;
    abortSignalStatics.any = undefined;
    abortSignalStatics.timeout = undefined;
    try {
      rememberPendingVtuPurchase('{"compat":true}', 'key-compat');
      notePendingVtuReference('{"compat":true}', 'VTU-COMPAT');
      const fetchMock = mockHistory(() => ({
        transactions: [
          {
            request_reference: 'VTU-COMPAT',
            status: 'successful',
            refund_pending: false,
          },
        ],
      }));
      vi.stubGlobal('fetch', fetchMock);

      renderHook(() => useUtilityRetainedSettlement(input));
      await act(async () => {});

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(recallPendingVtuKey('{"compat":true}')).toBe('key-compat');
      expect(isStalePendingVtuSuccess('{"compat":true}', 'VTU-COMPAT')).toBe(
        true
      );
    } finally {
      abortSignalStatics.any = realAny;
      abortSignalStatics.timeout = realTimeout;
    }
  });

  it('forgets refund-confirmed failures but retains pending ones', async () => {
    rememberPendingVtuPurchase('{"fail-done":true}', 'key-fail-done');
    notePendingVtuReference('{"fail-done":true}', 'VTU-FAIL-DONE');
    rememberPendingVtuPurchase('{"fail-open":true}', 'key-fail-open');
    notePendingVtuReference('{"fail-open":true}', 'VTU-FAIL-OPEN');
    rememberPendingVtuPurchase('{"still-out":true}', 'key-still-out');
    notePendingVtuReference('{"still-out":true}', 'VTU-PROCESSING');
    const fetchMock = mockHistory((url: string) => {
      if (url.includes('VTU-FAIL-DONE')) {
        return {
          transactions: [
            {
              request_reference: 'VTU-FAIL-DONE',
              status: 'failed',
              refund_pending: false,
              refunded_to_wallet: 500,
            },
          ],
        };
      }
      if (url.includes('VTU-FAIL-OPEN')) {
        return {
          transactions: [
            {
              request_reference: 'VTU-FAIL-OPEN',
              status: 'failed',
              refund_pending: true,
            },
          ],
        };
      }
      return {
        transactions: [
          { request_reference: 'VTU-PROCESSING', status: 'processing' },
        ],
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useUtilityRetainedSettlement(input));
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(recallPendingVtuKey('{"fail-done":true}')).toBeUndefined();
    expect(recallPendingVtuKey('{"fail-open":true}')).toBe('key-fail-open');
    expect(recallPendingVtuKey('{"still-out":true}')).toBe('key-still-out');
  });

  it('skips reference-less entries and stays idle without references', async () => {
    rememberPendingVtuPurchase('{"noanswer":true}', 'key-noanswer');
    const fetchMock = mockHistory(() => ({ transactions: [] }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useUtilityRetainedSettlement(input));
    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(recallPendingVtuKey('{"noanswer":true}')).toBe('key-noanswer');
  });

  it('never fetches when closed, unsigned, or merchantless', async () => {
    rememberPendingVtuPurchase('{"gated":true}', 'key-gated');
    notePendingVtuReference('{"gated":true}', 'VTU-GATED');
    const fetchMock = mockHistory(() => ({ transactions: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const closed = renderHook(() =>
      useUtilityRetainedSettlement({ ...input, enabled: false })
    );
    const unsigned = renderHook(() =>
      useUtilityRetainedSettlement({ ...input, userId: null })
    );
    const merchantless = renderHook(() =>
      useUtilityRetainedSettlement({ ...input, merchantSlug: null })
    );
    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(recallPendingVtuKey('{"gated":true}')).toBe('key-gated');
    closed.unmount();
    unsigned.unmount();
    merchantless.unmount();
  });

  it('leaves entries untouched when history errors or mismatches', async () => {
    rememberPendingVtuPurchase('{"flaky":true}', 'key-flaky');
    notePendingVtuReference('{"flaky":true}', 'VTU-FLAKY');
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useUtilityRetainedSettlement(input));
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Fail-open: the replay path still dedupes.
    expect(recallPendingVtuKey('{"flaky":true}')).toBe('key-flaky');
  });

  it('skips references tagged to another owner', async () => {
    // Codex R62 6rtokd: the registry survives switches by design —
    // the pass must only read the active account's references.
    const mine = buildPendingVtuScopeTag('user-1', 'merchant-1');
    const theirs = buildPendingVtuScopeTag('user-2', 'merchant-1');
    rememberPendingVtuPurchase('{"mine":true}', 'key-mine', mine);
    notePendingVtuReference('{"mine":true}', 'VTU-MINE');
    rememberPendingVtuPurchase('{"theirs":true}', 'key-theirs', theirs);
    notePendingVtuReference('{"theirs":true}', 'VTU-THEIRS');
    const fetchMock = mockHistory(() => ({ transactions: [] }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useUtilityRetainedSettlement(input));
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toContain(
      'reference=VTU-MINE'
    );
    expect(recallPendingVtuKey('{"theirs":true}')).toBe('key-theirs');
  });

  it('cancels the in-flight pass on account switch', async () => {
    rememberPendingVtuPurchase('{"switch":true}', 'key-switch');
    notePendingVtuReference('{"switch":true}', 'VTU-SWITCH');
    let release!: (value: unknown) => void;
    const gate = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    // The re-run pass fetches as user-2, whose server-scoped history
    // cannot contain user-1's reference.
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      const body =
        calls === 1 ? gate : Promise.resolve({ transactions: [] });
      return { ok: true, status: 200, json: () => body };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = renderHook(
      ({ userId }: { userId: string }) =>
        useUtilityRetainedSettlement({ ...input, userId }),
      { initialProps: { userId: 'user-1' } }
    );
    // Switch while the history read is in flight: the pass must not
    // forget for a result the submitter never saw.
    rerender({ userId: 'user-2' });
    await act(async () => {
      release({
        transactions: [
          {
            request_reference: 'VTU-SWITCH',
            status: 'successful',
            refund_pending: false,
          },
        ],
      });
    });

    expect(recallPendingVtuKey('{"switch":true}')).toBe('key-switch');
  });

  it('exposes the in-flight pass for the settle-then-submit gate', async () => {
    // Codex R60 6rs7PV: submits branch on this — non-null while the
    // pass runs, null once it lands (and when idle).
    rememberPendingVtuPurchase('{"gate":true}', 'key-gate');
    notePendingVtuReference('{"gate":true}', 'VTU-GATE');
    let release!: (value: unknown) => void;
    const gate = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: () => gate,
    }));
    vi.stubGlobal('fetch', fetchMock);

    expect(getPendingVtuSettlementPass()).toBeNull();
    renderHook(() => useUtilityRetainedSettlement(input));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const pass = getPendingVtuSettlementPass();
    expect(pass).toBeInstanceOf(Promise);

    await act(async () => {
      release({
        transactions: [
          {
            request_reference: 'VTU-GATE',
            status: 'successful',
            refund_pending: false,
          },
        ],
      });
      await pass;
    });
    expect(recallPendingVtuKey('{"gate":true}')).toBe('key-gate');
    expect(isStalePendingVtuSuccess('{"gate":true}', 'VTU-GATE')).toBe(true);
    expect(getPendingVtuSettlementPass()).toBeNull();
  });

  it('reports no pass when idle', async () => {
    renderHook(() => useUtilityRetainedSettlement(input));
    await act(async () => {});

    expect(getPendingVtuSettlementPass()).toBeNull();
  });
});
