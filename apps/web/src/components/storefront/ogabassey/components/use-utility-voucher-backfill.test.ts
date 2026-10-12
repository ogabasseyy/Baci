import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isUtilityVoucherBackfillTab,
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
            },
          ],
        },
        'VTU-1'
      )
    ).toEqual({ failed: false, pin: '1234-5678' });
  });

  it('reports terminal failure without a pin', () => {
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [
            { request_reference: 'VTU-1', status: 'failed' },
          ],
        },
        'VTU-1'
      )
    ).toEqual({ failed: true, pin: null });
  });

  it('keeps polling when the row is missing or pin-less and non-terminal', () => {
    expect(
      parseUtilityVoucherBackfill({ transactions: [] }, 'VTU-1')
    ).toEqual({ failed: false, pin: null });
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [
            { request_reference: 'VTU-1', status: 'processing' },
          ],
        },
        'VTU-1'
      )
    ).toEqual({ failed: false, pin: null });
  });

  it('returns null on a schema mismatch so polling halts', () => {
    expect(parseUtilityVoucherBackfill({ nope: true }, 'VTU-1')).toBeNull();
    expect(parseUtilityVoucherBackfill(null, 'VTU-1')).toBeNull();
  });
});

describe('isUtilityVoucherBackfillTab', () => {
  it('covers bill tabs only', () => {
    expect(isUtilityVoucherBackfillTab('power')).toBe(true);
    expect(isUtilityVoucherBackfillTab('tv')).toBe(true);
    expect(isUtilityVoucherBackfillTab('betting')).toBe(true);
    expect(isUtilityVoucherBackfillTab('airtime')).toBe(false);
    expect(isUtilityVoucherBackfillTab('data')).toBe(false);
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

  it('resolves the pin once a poll finds it', async () => {
    let calls = 0;
    const fetchMock = mockHistory(() => {
      calls += 1;
      return {
        transactions:
          calls < 3
            ? [{ request_reference: 'VTU-1', status: 'processing' }]
            : [
                {
                  request_reference: 'VTU-1',
                  status: 'successful',
                  voucher_pin: 'PIN-1',
                },
              ],
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    expect(result.current).toEqual({ failed: false, pin: null });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 3
      );
    });

    expect(result.current).toEqual({ failed: false, pin: 'PIN-1' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Polling stops after resolution: no further fetches.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 3
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports terminal failure and stops', async () => {
    const fetchMock = mockHistory(() => ({
      transactions: [{ request_reference: 'VTU-1', status: 'failed' }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
      );
    });

    expect(result.current).toEqual({ failed: true, pin: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps attempts when the pin never arrives', async () => {
    const fetchMock = mockHistory(() => ({
      transactions: [{ request_reference: 'VTU-1', status: 'processing' }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS *
          (UTILITY_VOUCHER_BACKFILL_MAX_ATTEMPTS + 2)
      );
    });

    expect(result.current).toEqual({ failed: false, pin: null });
    expect(fetchMock).toHaveBeenCalledTimes(
      UTILITY_VOUCHER_BACKFILL_MAX_ATTEMPTS
    );
  });

  it('halts on HTTP errors instead of burning attempts', async () => {
    const fetchMock = mockHistory(() => ({}), false, 500);
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUtilityVoucherBackfill(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 3
      );
    });

    expect(result.current).toEqual({ failed: false, pin: null });
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

  it('never fetches for non-bill tabs or missing inputs', async () => {
    const fetchMock = mockHistory(() => ({ transactions: [] }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useUtilityVoucherBackfill({ ...input, utilityTab: 'airtime' }));
    renderHook(() =>
      useUtilityVoucherBackfill({ ...input, merchantSlug: null })
    );
    renderHook(() => useUtilityVoucherBackfill({ ...input, enabled: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS * 2
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
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
});
