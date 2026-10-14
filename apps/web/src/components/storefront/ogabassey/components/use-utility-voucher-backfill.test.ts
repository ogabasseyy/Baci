import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessionMocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: sessionMocks.getSession } }),
}));
import {
  clearPendingVtuKeys,
  notePendingVtuReference,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from './utility-pending-idempotency';
import {
  isTokenBackfillTab,
  isUtilityBackfillTab,
  parseUtilityVoucherBackfill,
  useUtilityVoucherBackfill,
  UTILITY_VOUCHER_BACKFILL_MAX_ATTEMPTS,
  UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS,
  UTILITY_VOUCHER_BACKFILL_REQUEST_TIMEOUT_MS,
  UTILITY_VOUCHER_BACKFILL_SLOW_ATTEMPTS,
} from './use-utility-voucher-backfill';

describe('parseUtilityVoucherBackfill', () => {
  it('extracts the pin for the matching reference', () => {
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [
            { request_reference: 'OTHER', status: 'successful' },
            {
              request_reference: 'VTU-1',
              status: 'successful',
              voucher_pin: ' 1234-5678 ',
              refund_pending: false,
            },
          ],
        },
        'VTU-1'
      )
    ).toEqual({
      failed: false,
      pin: '1234-5678',
      refundConfirmed: true,
      refundedAmount: null,
      successful: true,
    });
  });

  it('reports success even when no voucher is expected', () => {
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [
            {
              request_reference: 'VTU-1',
              status: 'successful',
              refund_pending: false,
            },
          ],
        },
        'VTU-1'
      )
    ).toEqual({
      failed: false,
      pin: null,
      refundConfirmed: true,
      refundedAmount: null,
      successful: true,
    });
  });

  it('reports a refund-confirmed failure with the amount', () => {
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [
            {
              request_reference: 'VTU-1',
              status: 'failed',
              refund_pending: false,
              refunded_to_wallet: 1000,
            },
          ],
        },
        'VTU-1'
      )
    ).toEqual({
      failed: true,
      pin: null,
      refundConfirmed: true,
      refundedAmount: 1000,
      successful: false,
    });
  });

  it('marks a failed row with a pending refund as unconfirmed', () => {
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [
            {
              request_reference: 'VTU-1',
              status: 'failed',
              refund_pending: true,
            },
          ],
        },
        'VTU-1'
      )
    ).toEqual({
      failed: true,
      pin: null,
      refundConfirmed: false,
      refundedAmount: null,
      successful: false,
    });
  });

  it('fails closed when the refund flag is missing', () => {
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [{ request_reference: 'VTU-1', status: 'failed' }],
        },
        'VTU-1'
      )
    ).toMatchObject({ failed: true, refundConfirmed: false });
  });

  it('keeps polling when the row is missing or pin-less and non-terminal', () => {
    expect(parseUtilityVoucherBackfill({ transactions: [] }, 'VTU-1')).toEqual(
      {
        failed: false,
        pin: null,
        refundConfirmed: false,
        refundedAmount: null,
        successful: false,
      }
    );
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [{ request_reference: 'VTU-1', status: 'processing' }],
        },
        'VTU-1'
      )
    ).toMatchObject({ failed: false, pin: null, successful: false });
  });

  it('returns null on a schema mismatch so polling halts', () => {
    expect(parseUtilityVoucherBackfill({ nope: true }, 'VTU-1')).toBeNull();
    expect(parseUtilityVoucherBackfill(null, 'VTU-1')).toBeNull();
  });
});

describe('isUtilityBackfillTab', () => {
  it('covers every utility tab (telco rides along for settlement)', () => {
    expect(isUtilityBackfillTab('power')).toBe(true);
    expect(isUtilityBackfillTab('tv')).toBe(true);
    expect(isUtilityBackfillTab('betting')).toBe(true);
    expect(isUtilityBackfillTab('airtime')).toBe(true);
    expect(isUtilityBackfillTab('data')).toBe(true);
    expect(isUtilityBackfillTab('nope')).toBe(false);
  });
});

describe('isTokenBackfillTab', () => {
  it('covers only the bill tabs whose success may gain a late token', () => {
    expect(isTokenBackfillTab('power')).toBe(true);
    expect(isTokenBackfillTab('tv')).toBe(true);
    expect(isTokenBackfillTab('betting')).toBe(true);
    expect(isTokenBackfillTab('airtime')).toBe(false);
    expect(isTokenBackfillTab('data')).toBe(false);
    expect(isTokenBackfillTab('nope')).toBe(false);
  });
});

describe('useUtilityVoucherBackfill', () => {
  // Mutable polling account: tests flip this mid-poll to simulate
  // an account switch between capture and terminal observation.
  let currentUserId: string | null = 'user-1';

  beforeEach(() => {
    vi.useFakeTimers();
    currentUserId = 'user-1';
    sessionMocks.getSession.mockImplementation(async () => ({
      data: {
        session:
          currentUserId === null
            ? null
            : { user: { id: currentUserId } },
      },
      error: null,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function mockHistory(
    impl: (url: string) => unknown,
    ok = true,
    status = 200
  ) {
    return vi.fn(async (url: string) => ({
      ok,
      status,
      json: async () => impl(url),
    }));
  }

  const input = {
    enabled: true,
    merchantSlug: 'ogabassey',
    reference: 'VTU-1',
    utilityTab: 'power',
  };

  const pendingRow = { request_reference: 'VTU-1', status: 'processing' };

  it('resolves the pin once a poll finds it', async () => {
    let calls = 0;
    const fetchMock = mockHistory(() => {
      calls += 1;
      return {
        transactions:
          calls < 3
            ? [pendingRow]
            : [
                {
                  request_reference: 'VTU-1',
                  status: 'successful',
                  voucher_pin: 'PIN-1',
                  refund_pending: false,
                },
              ],
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    expect(result.current.pin).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 3
      );
    });

    expect(result.current).toMatchObject({ pin: 'PIN-1', successful: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Polling stops after resolution: no further fetches.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 3
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('bounds each poll with a per-request timeout', async () => {
    // Codex R62 6rtokb + R66 6rvh_R: a hung history read must
    // consume one attempt, not stall every later poll. The shared
    // fetchWithTimeout composes AbortController + setTimeout (no
    // AbortSignal.any/.timeout — missing below the safari 15.4
    // floor), and its timer runs on fake timers, so this drives a
    // REAL timeout instead of the old manual-abort spy. The mock
    // honors the abort signal, like a real fetch.
    let calls = 0;
    const fetchMock = vi.fn(
      async (_url: string, init?: { signal?: AbortSignal }) => {
        calls += 1;
        if (calls === 1) {
          await new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(
                new DOMException(
                  'The operation was aborted.',
                  'AbortError'
                )
              );
            });
          });
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            transactions: [
              {
                request_reference: 'VTU-1',
                status: 'successful',
                voucher_pin: 'PIN-1',
                refund_pending: false,
              },
            ],
          }),
        };
      }
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The 10s request bound fires: attempt 1 fails, the loop sleeps
    // one poll interval, attempt 2 resolves the pin.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_REQUEST_TIMEOUT_MS +
          UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({
      pin: 'PIN-1',
      successful: true,
    });
  });

  it('polls without AbortSignal.any/.timeout (safari 15.4 floor)', async () => {
    // Codex R66 6rvh_R: with the unsupported APIs removed, a normal
    // poll still resolves — any regression to AbortSignal.any throws
    // before fetch runs, so no fetch happens and the pin never lands.
    const abortSignalStatics = AbortSignal as unknown as Record<
      string,
      unknown
    >;
    const realAny = abortSignalStatics.any;
    const realTimeout = abortSignalStatics.timeout;
    abortSignalStatics.any = undefined;
    abortSignalStatics.timeout = undefined;
    try {
      const fetchMock = mockHistory(() => ({
        transactions: [
          {
            request_reference: 'VTU-1',
            status: 'successful',
            voucher_pin: 'PIN-1',
            refund_pending: false,
          },
        ],
      }));
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useUtilityVoucherBackfill(input));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
        );
      });

      expect(fetchMock).toHaveBeenCalled();
      expect(result.current).toMatchObject({
        pin: 'PIN-1',
        successful: true,
      });
    } finally {
      abortSignalStatics.any = realAny;
      abortSignalStatics.timeout = realTimeout;
    }
  });

  it('bounds a stalled response body and retries the poll', async () => {
    // Codex R68 6rwg9A: the fetch helper resolves on headers, so a
    // body that never streams would hang the attempt forever without
    // the shared body-read bound. Codex R70 6ryArL: headers arrive
    // 100ms before the bound — the body shares the REMAINDER, so
    // attempt 2 still starts at 10s + poll (not ~20s + poll).
    let calls = 0;
    const seenSignals: Array<AbortSignal | undefined> = [];
    const fetchMock = vi.fn(
      async (_url: string, init?: { signal?: AbortSignal }) => {
        seenSignals.push(init?.signal);
        calls += 1;
        if (calls === 1) {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              UTILITY_VOUCHER_BACKFILL_REQUEST_TIMEOUT_MS - 100
            )
          );
        }
        return {
          ok: true,
          status: 200,
          json:
            calls === 1
              ? () => new Promise(() => {})
              : async () => ({
                  transactions: [
                    {
                      request_reference: 'VTU-1',
                      status: 'successful',
                      voucher_pin: 'PIN-1',
                      refund_pending: false,
                    },
                  ],
                }),
        };
      }
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The 10s body bound fires: attempt 1 fails, the loop sleeps one
    // poll interval, attempt 2 resolves the pin.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_REQUEST_TIMEOUT_MS +
          UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ pin: 'PIN-1', successful: true });
    // R72: the stalled attempt-1 fetch was aborted pre-retry; the
    // successful attempt-2 fetch was untouched.
    expect(seenSignals[0]?.aborted).toBe(true);
    expect(seenSignals[1]?.aborted).toBe(false);
  });

  it('scopes history polls by reference', async () => {
    const seen: string[] = [];
    const fetchMock = mockHistory((url: string) => {
      seen.push(url);
      return { transactions: [pendingRow] };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
      );
    });

    // Every poll carries the exact reference: the target row is
    // returned even when 20+ newer rows of the type exist.
    expect(fetchMock).toHaveBeenCalled();
    for (const url of seen) {
      expect(url).toContain('reference=VTU-1');
    }
  });

  it('resolves pin-less success instead of polling forever', async () => {
    const fetchMock = mockHistory(() => ({
      transactions: [
        {
          request_reference: 'VTU-1',
          status: 'successful',
          refund_pending: false,
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    // Tokenless tab: no token can arrive, so success settles the loop
    // (bill tabs keep hunting — see the token-hunt test below).
    const { result } = renderHook(() =>
      useUtilityVoucherBackfill({ ...input, utilityTab: 'airtime' })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
      );
    });

    expect(result.current).toMatchObject({ pin: null, successful: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('waits for refund confirmation before terminalizing a failure', async () => {
    let calls = 0;
    const fetchMock = mockHistory(() => {
      calls += 1;
      return {
        transactions: [
          calls < 2
            ? {
                request_reference: 'VTU-1',
                status: 'failed',
                refund_pending: true,
              }
            : {
                request_reference: 'VTU-1',
                status: 'failed',
                refund_pending: false,
                refunded_to_wallet: 1000,
              },
        ],
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 2
      );
    });

    // First poll saw failed+pending (nonterminal, kept polling); the
    // second saw the confirmed refund.
    expect(result.current).toEqual({
      failed: true,
      pin: null,
      refundConfirmed: true,
      refundedAmount: 1000,
      successful: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces failed-pending observations while polling continues', async () => {
    const fetchMock = mockHistory(() => ({
      transactions: [
        {
          request_reference: 'VTU-1',
          status: 'failed',
          refund_pending: true,
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 2
      );
    });

    // Nonterminal but visible: the view shows the pending-refund card
    // instead of the spinner while attempts continue.
    expect(result.current).toMatchObject({
      failed: true,
      refundConfirmed: false,
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('caps attempts when nothing terminal arrives', async () => {
    const fetchMock = mockHistory(() => ({ transactions: [pendingRow] }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      // Past the full backoff window: 10×3s + 33×10s + 30×60s + margin.
      await vi.advanceTimersByTimeAsync(2_200_000);
    });

    expect(result.current.successful).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(
      UTILITY_VOUCHER_BACKFILL_MAX_ATTEMPTS
    );
  });

  it('backs off to 10s after the first 10 fast attempts', async () => {
    const fetchMock = mockHistory(() => ({ transactions: [pendingRow] }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      // t=35s: attempts 1-10 at 3s cadence (t=0..27), #11 at t=30,
      // #12 not until t=40.
      await vi.advanceTimersByTimeAsync(35_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(11);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(12);
  });

  it('retries transient 5xx within the attempt budget', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          transactions: [
            {
              request_reference: 'VTU-1',
              status: 'successful',
              voucher_pin: 'PIN-1',
              refund_pending: false,
            },
          ],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 2
      );
    });

    expect(result.current.pin).toBe('PIN-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries network failures within the attempt budget', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('Network request failed');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          transactions: [
            {
              request_reference: 'VTU-1',
              status: 'successful',
              voucher_pin: 'TOKEN-1',
              refund_pending: false,
            },
          ],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 2
      );
    });

    expect(result.current.successful).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('halts on non-retriable 4xx instead of burning attempts', async () => {
    const fetchMock = mockHistory(() => ({}), false, 401);
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 3
      );
    });

    expect(result.current.successful).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('halts on schema mismatches', async () => {
    const fetchMock = mockHistory(() => ({ nope: true }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 3
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never fetches for unknown tabs or missing inputs', async () => {
    const fetchMock = mockHistory(() => ({ transactions: [] }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useUtilityVoucherBackfill({ ...input, utilityTab: 'nope' }));
    renderHook(() => useUtilityVoucherBackfill({ ...input, merchantSlug: null }));
    renderHook(() => useUtilityVoucherBackfill({ ...input, enabled: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 2
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('polls telco processing purchases for settlement', async () => {
    const fetchMock = mockHistory(() => ({
      transactions: [
        {
          request_reference: 'VTU-1',
          status: 'successful',
          refund_pending: false,
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useUtilityVoucherBackfill({ ...input, utilityTab: 'airtime' })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
      );
    });

    expect(result.current.successful).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toContain(
      'type=airtime'
    );
  });

  it('queries history scoped to the tab type and merchant', async () => {
    const fetchMock = mockHistory(() => ({ transactions: [] }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('/api/vtu/history?');
    expect(url).toContain('merchantSlug=ogabassey');
    expect(url).toContain('type=electricity');
  });

  it('forgets the retained entry when history reports success', async () => {
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('{"hook":true}', 'key-hook');
    notePendingVtuReference('{"hook":true}', 'VTU-1');
    const fetchMock = mockHistory(() => ({
      transactions: [
        {
          request_reference: 'VTU-1',
          status: 'successful',
          refund_pending: false,
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    // Airtime: no token can arrive, so success settles the loop. The
    // success is shown, so the entry is forgotten: an identical
    // repeat must mint fresh rather than replay the old vend.
    renderHook(() => useUtilityVoucherBackfill({ ...input, utilityTab: 'airtime' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 2
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(recallPendingVtuKey('{"hook":true}')).toBeUndefined();
  });

  it('retains the entry when the account switches before terminality', async () => {
    // Mobile parity (Muse R57): the terminal result was never shown
    // to the submitter, so their key must stay — a switch-back
    // identical purchase replays instead of minting fresh and
    // debiting a second time.
    // Codex R85 P1: the cross-account observation must not even be
    // PUBLISHED — publishing would show the previous customer's
    // result to the new account and fire onSettled (forgetting the
    // submitter's key despite the guarded direct forget). The loop
    // keeps polling unpublished so a switch-back still resolves.
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('{"hook-switch":true}', 'key-hook-switch');
    notePendingVtuReference('{"hook-switch":true}', 'VTU-1');
    let calls = 0;
    const fetchMock = mockHistory(() => {
      calls += 1;
      return calls === 1
        ? { transactions: [pendingRow] }
        : {
            transactions: [
              {
                request_reference: 'VTU-1',
                status: 'successful',
                refund_pending: false,
              },
            ],
          };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useUtilityVoucherBackfill({ ...input, utilityTab: 'airtime' })
    );
    // Attempt 1 (pending) runs as user-1; switch before attempt 2.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    currentUserId = 'user-2';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
      );
    });

    expect(result.current.successful).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(recallPendingVtuKey('{"hook-switch":true}')).toBe(
      'key-hook-switch'
    );

    // Switch-back resumes: the next poll publishes and forgets.
    currentUserId = 'user-1';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
      );
    });
    expect(result.current.successful).toBe(true);
    expect(recallPendingVtuKey('{"hook-switch":true}')).toBeUndefined();
  });

  it('withholds the voucher pin observed under a different account', async () => {
    // Codex R85 P1: a success+pin resolving after an account switch
    // belongs to the previous customer — publishing it would render
    // their voucher PIN (resolvedPin = voucherPin ?? backfill.pin)
    // to the new account. Withhold until the submitter returns.
    let calls = 0;
    const fetchMock = mockHistory(() => {
      calls += 1;
      return calls === 1
        ? { transactions: [pendingRow] }
        : {
            transactions: [
              {
                request_reference: 'VTU-1',
                status: 'successful',
                voucher_pin: 'PIN-PREVIOUS-USER',
                refund_pending: false,
              },
            ],
          };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    currentUserId = 'user-2';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
      );
    });

    expect(result.current.pin).toBeNull();
    expect(result.current.successful).toBe(false);

    currentUserId = 'user-1';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
      );
    });
    expect(result.current.pin).toBe('PIN-PREVIOUS-USER');
  });

  it('retains the entry when the view unmounts during the session read', async () => {
    // Codex R68 6rwg83: the terminal result was parsed but the view
    // unmounted while getSession() was pending — forgetting now would
    // mint fresh on reopen and debit twice. Cancellation is
    // rechecked after the read.
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('{"hook-unmount":true}', 'key-hook-unmount');
    notePendingVtuReference('{"hook-unmount":true}', 'VTU-1');
    const fetchMock = mockHistory(() => ({
      transactions: [
        {
          request_reference: 'VTU-1',
          status: 'successful',
          refund_pending: false,
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    // First read captures the submitter; the re-verification hangs.
    sessionMocks.getSession.mockClear();
    sessionMocks.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    });
    let releaseRead!: (value: unknown) => void;
    const readGate = new Promise((resolve) => {
      releaseRead = resolve;
    });
    sessionMocks.getSession.mockReturnValueOnce(readGate);

    const { unmount } = renderHook(() =>
      useUtilityVoucherBackfill({ ...input, utilityTab: 'airtime' })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sessionMocks.getSession).toHaveBeenCalledTimes(2);

    act(() => {
      unmount();
    });
    releaseRead({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(recallPendingVtuKey('{"hook-unmount":true}')).toBe(
      'key-hook-unmount'
    );
  });

  it('retains the entry when no session is captured', async () => {
    // Fail closed like mobile: a null capture never forgets — and
    // (Codex R85 P1) never publishes either, since no polling
    // account was established to attribute the result to.
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('{"hook-nosession":true}', 'key-hook-nosession');
    notePendingVtuReference('{"hook-nosession":true}', 'VTU-1');
    currentUserId = null;
    const fetchMock = mockHistory(() => ({
      transactions: [
        {
          request_reference: 'VTU-1',
          status: 'successful',
          refund_pending: false,
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useUtilityVoucherBackfill({ ...input, utilityTab: 'airtime' })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 2
      );
    });

    expect(result.current.successful).toBe(false);
    expect(recallPendingVtuKey('{"hook-nosession":true}')).toBe(
      'key-hook-nosession'
    );
  });

  it('settles a row that lands in the patient lane past the slow window', async () => {
    // Reconciliation backlog: the row sits on a later 25-row page and
    // settles ~20 minutes in — past the 6-minute slow window. The
    // patient lane must still observe it and forget the entry, or a
    // later identical purchase replays the old vend as new (6rrU6M).
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('{"hook-late":true}', 'key-hook-late');
    notePendingVtuReference('{"hook-late":true}', 'VTU-1');
    let calls = 0;
    const fetchMock = mockHistory(() => {
      calls += 1;
      return calls <= UTILITY_VOUCHER_BACKFILL_SLOW_ATTEMPTS
        ? { transactions: [pendingRow] }
        : {
            transactions: [
              {
                request_reference: 'VTU-1',
                status: 'successful',
                refund_pending: false,
              },
            ],
          };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useUtilityVoucherBackfill({ ...input, utilityTab: 'airtime' })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_200_000);
    });

    expect(result.current.successful).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(
      UTILITY_VOUCHER_BACKFILL_SLOW_ATTEMPTS + 1
    );
    expect(recallPendingVtuKey('{"hook-late":true}')).toBeUndefined();
  });

  it('keeps hunting a token for pin-less bill successes', async () => {
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('{"hook-token":true}', 'key-hook-token');
    notePendingVtuReference('{"hook-token":true}', 'VTU-1');
    const fetchMock = mockHistory(() => ({
      transactions: [
        {
          request_reference: 'VTU-1',
          status: 'successful',
          refund_pending: false,
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    // Power: success forgets the retained entry immediately, but
    // the loop keeps polling while a late token may still arrive.
    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(result.current.successful).toBe(true);
    expect(recallPendingVtuKey('{"hook-token":true}')).toBeUndefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops the token hunt once the pin lands', async () => {
    const fetchMock = mockHistory(() => ({
      transactions: [
        {
          request_reference: 'VTU-1',
          status: 'successful',
          voucher_pin: 'TOKEN-1',
          refund_pending: false,
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 2
      );
    });

    expect(result.current.pin).toBe('TOKEN-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forgets the retained entry on refund-confirmed failure', async () => {
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('{"hook-fail":true}', 'key-hook-fail');
    notePendingVtuReference('{"hook-fail":true}', 'VTU-1');
    const fetchMock = mockHistory(() => ({
      transactions: [
        {
          request_reference: 'VTU-1',
          status: 'failed',
          refund_pending: false,
          refunded_to_wallet: 1000,
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(recallPendingVtuKey('{"hook-fail":true}')).toBeUndefined();
  });
});
