import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRepairDeviceSuggestions } from './useRepairDeviceSuggestions';

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api-client', () => ({ apiGet: mocks.apiGet }));

describe('useRepairDeviceSuggestions', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('retains the repair lookup failure when store products have no repairable devices', async () => {
    vi.useFakeTimers();
    mocks.apiGet
      .mockRejectedValueOnce(new Error('repair catalog unavailable'))
      .mockResolvedValueOnce({ products: [] });

    const { result } = renderHook(() =>
      useRepairDeviceSuggestions({
        catalogEnabled: true,
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        query: 'iPhone 15',
        repairCatalogEnabled: true,
        selectedModel: null,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(result.current).toMatchObject({
      hasSearched: true,
      isLoading: false,
      lookupFailed: true,
      suggestions: [],
    });
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
  });

  it('shows repair matches without waiting for the concurrent product fallback', async () => {
    vi.useFakeTimers();
    let resolveProducts: ((value: { products: [] }) => void) | undefined;
    mocks.apiGet.mockImplementation((url: unknown) => {
      if (typeof url === 'string' && url.includes('/repairs/devices')) {
        return Promise.resolve({
          groups: [
            {
              brand: 'Apple',
              devices: [
                {
                  id: 'device-1',
                  brand: 'Apple',
                  model: 'iPhone 15',
                  slug: 'iphone-15',
                  deviceType: 'Smartphone',
                },
              ],
            },
          ],
        });
      }
      return new Promise((resolve) => {
        resolveProducts = resolve;
      });
    });

    const { result } = renderHook(() =>
      useRepairDeviceSuggestions({
        catalogEnabled: true,
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        query: 'iPhone 15',
        repairCatalogEnabled: true,
        selectedModel: null,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(result.current).toMatchObject({
      hasSearched: true,
      isLoading: false,
      suggestions: [{ id: 'device-1' }],
    });
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
    resolveProducts?.({ products: [] });
  });

  it('hides results from the previous query immediately while the next query debounces', async () => {
    vi.useFakeTimers();
    mocks.apiGet
      .mockResolvedValueOnce({
        groups: [
          {
            brand: 'Apple',
            devices: [
              {
                id: 'device-1',
                brand: 'Apple',
                model: 'iPhone 15',
                slug: 'iphone-15',
                deviceType: 'Smartphone',
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({ products: [] })
      .mockResolvedValueOnce({ groups: [] })
      .mockResolvedValueOnce({ products: [] });

    const { result, rerender } = renderHook(
      ({ query }) =>
        useRepairDeviceSuggestions({
          catalogEnabled: true,
          merchantId: 'merchant-1',
          merchantSlug: 'ogabassey',
          query,
          repairCatalogEnabled: true,
          selectedModel: null,
        }),
      { initialProps: { query: 'iPhone 15' } }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(result.current.suggestions).toHaveLength(1);

    rerender({ query: 'Galaxy S24' });

    expect(result.current).toMatchObject({
      hasSearched: false,
      suggestions: [],
    });
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(mocks.apiGet).toHaveBeenCalledTimes(4);
  });

  it('aborts and clears an active lookup when suggestions are dismissed', async () => {
    vi.useFakeTimers();
    let resolveLookup: ((value: { groups: [] }) => void) | undefined;
    mocks.apiGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLookup = resolve;
        })
    );

    const { result } = renderHook(() =>
      useRepairDeviceSuggestions({
        catalogEnabled: true,
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        query: 'PlayStation 5',
        repairCatalogEnabled: true,
        selectedModel: null,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(result.current.isLoading).toBe(true);
    const requestSignal = mocks.apiGet.mock.calls[0]?.[1]?.signal as
      | AbortSignal
      | undefined;

    act(() => result.current.clearSuggestions());

    expect(requestSignal?.aborted).toBe(true);
    expect(result.current).toMatchObject({
      hasSearched: false,
      isLoading: false,
      lookupFailed: false,
      suggestions: [],
    });

    await act(async () => {
      resolveLookup?.({ groups: [] });
    });
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.hasSearched).toBe(false);
  });

  it('cancels a queued lookup when suggestions are dismissed before debounce', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useRepairDeviceSuggestions({
        catalogEnabled: true,
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        query: 'PlayStation 5',
        repairCatalogEnabled: true,
        selectedModel: null,
      })
    );

    act(() => result.current.clearSuggestions());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(mocks.apiGet).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      hasSearched: false,
      isLoading: false,
      suggestions: [],
    });
  });
});
