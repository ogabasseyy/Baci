import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutocompleteSuggestions } from './use-autocomplete-suggestions';

function mockFetch(payload: unknown) {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
  ) as unknown as typeof fetch;
}

describe('useAutocompleteSuggestions', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches suggestions for a long-enough debounced query', async () => {
    mockFetch({
      suggestions: [{ id: 'p1', name: 'iPhone' }],
      popularSearches: [{ search_query: 'galaxy', search_count: 3 }],
    });
    const onResultsReceived = vi.fn();

    const { result } = renderHook(() =>
      useAutocompleteSuggestions({
        debouncedValue: 'iph',
        merchantId: 'm1',
        onResultsReceived,
        refetchToken: 0,
      })
    );

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    });
    expect(result.current.popularSearches).toHaveLength(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.settledQuery).toBe('iph');
    expect(onResultsReceived).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/search/autocomplete?q=iph&merchant_id=m1&limit=10',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('never fetches for short queries', () => {
    mockFetch({ suggestions: [], popularSearches: [] });
    const onResultsReceived = vi.fn();

    const { result } = renderHook(() =>
      useAutocompleteSuggestions({
        debouncedValue: 'i',
        merchantId: 'm1',
        onResultsReceived,
        refetchToken: 0,
      })
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(onResultsReceived).not.toHaveBeenCalled();
  });

  it('leaves the settled query unset when the request fails', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error('autocomplete down'))
    ) as unknown as typeof fetch;
    const onResultsReceived = vi.fn();

    const { result } = renderHook(() =>
      useAutocompleteSuggestions({
        debouncedValue: 'iph',
        merchantId: 'm1',
        onResultsReceived,
        refetchToken: 0,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.settledQuery).toBeNull();
    expect(onResultsReceived).not.toHaveBeenCalled();
  });

  it('treats a JSON error response as a failure, not an empty result', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Failed' }),
      })
    ) as unknown as typeof fetch;
    const onResultsReceived = vi.fn();

    const { result } = renderHook(() =>
      useAutocompleteSuggestions({
        debouncedValue: 'iph',
        merchantId: 'm1',
        onResultsReceived,
        refetchToken: 0,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.settledQuery).toBeNull();
    expect(onResultsReceived).not.toHaveBeenCalled();
  });

  it('resets the settled query while a repeat request is pending', async () => {
    let resolveRepeat: (value: unknown) => void = () => undefined;
    const repeatJson = new Promise((resolve) => {
      resolveRepeat = resolve;
    });
    // Route by URL: successful suggestion fetches also emit an analytics
    // POST to /api/events, which must not consume a scripted response.
    const autocompleteResponses = [
      () =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              suggestions: [{ id: 'p1', name: 'iPhone' }],
              popularSearches: [],
            }),
        }),
      () => Promise.reject(new Error('down')),
      () => Promise.resolve({ ok: true, json: () => repeatJson }),
    ];
    globalThis.fetch = vi.fn((url: unknown) => {
      if (typeof url === 'string' && url.startsWith('/api/events')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      }
      const next = autocompleteResponses.shift();
      if (!next) {
        throw new Error(`unexpected autocomplete call: ${String(url)}`);
      }
      return next();
    }) as unknown as typeof fetch;
    const onResultsReceived = vi.fn();

    const { result, rerender } = renderHook(
      ({ debouncedValue }: { debouncedValue: string }) =>
        useAutocompleteSuggestions({
          debouncedValue,
          merchantId: 'm1',
          onResultsReceived,
          refetchToken: 0,
        }),
      { initialProps: { debouncedValue: 'aa' } }
    );

    await waitFor(() => {
      expect(result.current.settledQuery).toBe('aa');
    });

    rerender({ debouncedValue: 'bb' });
    await waitFor(() => {
      expect(result.current.suggestions).toEqual([]);
    });
    expect(result.current.settledQuery).toBeNull();

    // Returning to the first query must not reuse its stale settlement
    // while the retry is still pending.
    rerender({ debouncedValue: 'aa' });
    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });
    expect(result.current.settledQuery).toBeNull();

    await act(async () => {
      resolveRepeat({ suggestions: [], popularSearches: [] });
      await repeatJson;
    });
    await waitFor(() => {
      expect(result.current.settledQuery).toBe('aa');
    });
  });
});
