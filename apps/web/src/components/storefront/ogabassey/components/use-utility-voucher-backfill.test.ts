import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingVtuKeys,
  isStalePendingVtuSuccess,
  notePendingVtuReference,
  PENDING_VTU_STALE_AFTER_MS,
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
  beforeEach(() => {
    vi.useFakeTimers();
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
      // Past the ~6-minute backoff window: 10×3s + 33×10s + margin.
      await vi.advanceTimersByTimeAsync(400_000);
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

  it('marks the retained entry when history reports success', async () => {
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

    // Airtime: no token can arrive, so success settles the loop.
    renderHook(() => useUtilityVoucherBackfill({ ...input, utilityTab: 'airtime' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 2
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      isStalePendingVtuSuccess('{"hook":true}', 'VTU-1')
    ).toBe(false);
    expect(
      isStalePendingVtuSuccess(
        '{"hook":true}',
        'VTU-1',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
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

    // Power: success settles the registry immediately, but the loop
    // keeps polling while a late token may still arrive.
    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(result.current.successful).toBe(true);
    expect(
      isStalePendingVtuSuccess(
        '{"hook-token":true}',
        'VTU-1',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
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
