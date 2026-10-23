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
      .mockResolvedValueOnce({ groups: [] });

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
    expect(mocks.apiGet).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(mocks.apiGet).toHaveBeenCalledTimes(3);
  });
});
