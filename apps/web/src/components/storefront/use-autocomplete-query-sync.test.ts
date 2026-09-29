import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutocompleteQuerySync } from './use-autocomplete-query-sync';

function mockFetch(payload: unknown) {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
  ) as unknown as typeof fetch;
}

const SUGGESTION_PAYLOAD = {
  suggestions: [{ id: 'p1', name: 'iPhone' }],
  popularSearches: [],
};

function setup(
  overrides: Partial<Parameters<typeof useAutocompleteQuerySync>[0]> = {}
) {
  const onChange = vi.fn();
  const onHighlightReset = vi.fn();
  const onOpenChange = vi.fn();
  const initialProps = {
    value: 'iphone',
    merchantId: 'm1',
    isOpen: false,
    canEagerOpen: true,
    isPopupLength: (text: string) => text.trim().length > 0,
    onChange,
    onHighlightReset,
    onOpenChange,
    ...overrides,
  };
  const rendered = renderHook(
    (props: typeof initialProps) => useAutocompleteQuerySync(props),
    { initialProps }
  );
  return {
    ...rendered,
    initialProps,
    onChange,
    onHighlightReset,
    onOpenChange,
  };
}

describe('useAutocompleteQuerySync', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fetches on mount and opens when results arrive', async () => {
    mockFetch(SUGGESTION_PAYLOAD);

    const { onHighlightReset, onOpenChange, result } = setup();

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    });
    expect(result.current.settledQuery).toBe('iphone');
    expect(onHighlightReset).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('clears and closes when the value becomes too short', async () => {
    mockFetch(SUGGESTION_PAYLOAD);

    const { initialProps, onHighlightReset, onOpenChange, rerender, result } =
      setup({ isPopupLength: (text: string) => text.length >= 2 });

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    });
    onOpenChange.mockClear();
    onHighlightReset.mockClear();

    rerender({ ...initialProps, value: 'i' });

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.settledQuery).toBeNull();
    expect(onHighlightReset).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('forwards input edits and opens eagerly for submit-wired consumers', () => {
    mockFetch(SUGGESTION_PAYLOAD);

    const { onChange, onHighlightReset, onOpenChange, result } = setup();

    act(() => {
      result.current.handleInputChange('iph');
    });

    expect(onChange).toHaveBeenCalledWith('iph');
    expect(onHighlightReset).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('suppresses result-driven reopening after navigation preparation', async () => {
    mockFetch(SUGGESTION_PAYLOAD);

    const { initialProps, onHighlightReset, onOpenChange, rerender, result } =
      setup();

    act(() => {
      result.current.prepareNavigation();
    });
    expect(result.current.suggestions).toEqual([]);

    // The submitted value syncs back after navigation and starts a fresh
    // request: its results must reset the highlight but not reopen. (The
    // rerender itself is an external change with its own reset; clear it
    // so the assertions below cover only the results arrival.)
    rerender({ ...initialProps, value: 'iphone case' });
    onHighlightReset.mockClear();

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    });
    expect(onHighlightReset).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('drops options on an external value change', async () => {
    mockFetch(SUGGESTION_PAYLOAD);

    const { initialProps, onHighlightReset, rerender, result } = setup();

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    });
    onHighlightReset.mockClear();

    // A prop change that bypasses handleInputChange is a wholesale context
    // switch (e.g. route sync), not live-update typing.
    rerender({ ...initialProps, value: 'galaxy' });

    expect(result.current.suggestions).toEqual([]);
    expect(onHighlightReset).toHaveBeenCalledTimes(1);
  });

  it('restarts the request when an external change returns to the debounced query', async () => {
    mockFetch(SUGGESTION_PAYLOAD);

    const { initialProps, rerender, result } = setup();

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    });
    // Scope to the autocomplete endpoint: result tracking also emits an
    // analytics beacon through the shared fetch mock.
    const fetchMock = vi.mocked(globalThis.fetch);
    const autocompleteCalls = () =>
      fetchMock.mock.calls.filter(
        ([url]) =>
          typeof url === 'string' && url.startsWith('/api/search/autocomplete')
      );
    expect(autocompleteCalls()).toHaveLength(1);

    // Rapid external A -> B -> A within the debounce window: both legs
    // clear, but the debounced value never moves, so without an explicit
    // restart no fetch is scheduled and the popup stays empty.
    rerender({ ...initialProps, value: 'galaxy' });
    expect(result.current.suggestions).toEqual([]);
    rerender({ ...initialProps, value: 'iphone' });

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    });
    expect(autocompleteCalls()).toHaveLength(2);
    expect(autocompleteCalls()[1]?.[0]).toContain('q=iphone');
  });
});
