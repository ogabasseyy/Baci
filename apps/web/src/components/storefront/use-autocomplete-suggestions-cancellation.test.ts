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

  it('clears results and the loading flag on demand', async () => {
    mockFetch({ suggestions: [{ id: 'p1', name: 'iPhone' }] });
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

    act(() => {
      result.current.clearSuggestions();
    });

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.popularSearches).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.settledQuery).toBeNull();
  });

  it('abandons a superseded fetch instead of painting stale results', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    const firstJson = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    globalThis.fetch = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve({ ok: true, json: () => firstJson })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ suggestions: [], popularSearches: [] }),
        })
      ) as unknown as typeof fetch;
    const onResultsReceived = vi.fn();

    const { result, rerender } = renderHook(
      ({ debouncedValue }: { debouncedValue: string }) =>
        useAutocompleteSuggestions({
          debouncedValue,
          merchantId: 'm1',
          onResultsReceived,
          refetchToken: 0,
        }),
      { initialProps: { debouncedValue: 'iph' } }
    );

    rerender({ debouncedValue: 'ipho' });
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    // The superseded request resolves late with stale results.
    await act(async () => {
      resolveFirst({ suggestions: [{ id: 'stale', name: 'Stale' }] });
      await firstJson;
    });

    expect(
      result.current.suggestions.find((item) => item.id === 'stale')
    ).toBeUndefined();
  });

  it('aborts the in-flight request when suggestions are cleared', async () => {
    let resolveJson: (value: unknown) => void = () => undefined;
    const jsonPromise = new Promise((resolve) => {
      resolveJson = resolve;
    });
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => jsonPromise })
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
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
    const firstCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const signal = firstCall?.[1]?.signal as AbortSignal | undefined;
    expect(signal?.aborted).toBe(false);

    // Dismissing the popup (Escape / clear) cancels the pending fetch.
    act(() => {
      result.current.clearSuggestions();
    });
    expect(signal?.aborted).toBe(true);
    expect(result.current.loading).toBe(false);

    // The late response must neither repaint nor reopen the popup.
    await act(async () => {
      resolveJson({
        suggestions: [{ id: 'late', name: 'Late' }],
        popularSearches: [],
      });
      await jsonPromise;
    });

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.settledQuery).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(onResultsReceived).not.toHaveBeenCalled();
  });
});
