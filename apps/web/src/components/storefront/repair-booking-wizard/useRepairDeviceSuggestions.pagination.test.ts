import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRepairDeviceSuggestions } from './useRepairDeviceSuggestions';

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api-client', () => ({ apiGet: mocks.apiGet }));

describe('repair device product fallback pagination', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const renderSuggestions = () =>
    renderHook(() =>
      useRepairDeviceSuggestions({
        catalogEnabled: true,
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        query: 'iPhone 15',
        repairCatalogEnabled: false,
        selectedModel: null,
      })
    );

  it('continues past a page of non-device products to find catalog devices', async () => {
    vi.useFakeTimers();
    mocks.apiGet.mockImplementation((url: unknown) => {
      if (typeof url === 'string' && url.includes('offset=50')) {
        return Promise.resolve({
          count: 51,
          products: [
            { id: 'iphone-15', name: 'iPhone 15', category: 'Phones' },
          ],
        });
      }
      return Promise.resolve({
        count: 51,
        products: Array.from({ length: 50 }, (_, index) => ({
          id: `case-${index}`,
          name: `iPhone 15 Case ${index}`,
          category: 'Accessories',
        })),
      });
    });

    const { result } = renderSuggestions();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
    expect(mocks.apiGet.mock.calls[0]?.[0]).toContain('offset=0');
    expect(mocks.apiGet.mock.calls[1]?.[0]).toContain('offset=50');
    expect(result.current.suggestions).toMatchObject([
      { productId: 'iphone-15', deviceType: 'Smartphone' },
    ]);
  });

  it('caps fallback scans when every page contains unsupported products', async () => {
    vi.useFakeTimers();
    mocks.apiGet.mockImplementation((url: unknown) => {
      const offset = Number(
        new URLSearchParams(String(url).split('?')[1]).get('offset')
      );
      return Promise.resolve({
        count: 100_000,
        products: Array.from({ length: 50 }, (_, index) => ({
          id: `case-${offset + index}`,
          name: `iPhone 15 Case ${offset + index}`,
          category: 'Smartphones',
        })),
      });
    });

    const { result } = renderSuggestions();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(mocks.apiGet).toHaveBeenCalledTimes(5);
    expect(mocks.apiGet.mock.calls.at(-1)?.[0]).toContain('offset=200');
    expect(result.current).toMatchObject({
      hasSearched: true,
      isLoading: false,
      suggestions: [],
    });
  });
});
