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
});
