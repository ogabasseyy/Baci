import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mocks = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('@/lib/repair-catalog-client', () => ({
  fetchRepairDevices: (...args: unknown[]) => mocks(...args),
  RepairCatalogUnavailableError: class RepairCatalogUnavailableError extends Error {},
  RepairCatalogTimeoutError: class RepairCatalogTimeoutError extends Error {},
}));

import { useRepairDevices } from './use-repair-devices';

const sampleGroups = [
  {
    brand: 'Apple',
    devices: [
      {
        id: 'd1',
        brand: 'Apple',
        model: 'iPhone 13',
        slug: 'apple-iphone-13',
        deviceType: 'Smartphone' as const,
        imageUrl: null,
        productId: null,
      },
    ],
  },
];

describe('useRepairDevices', () => {
  beforeEach(() => {
    mocks.mockReset();
  });

  it('starts loading and then returns fetched groups', async () => {
    mocks.mockResolvedValueOnce(sampleGroups);

    const { result } = renderHook(() => useRepairDevices());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.groups).toEqual(sampleGroups);
    expect(result.current.brandGroups).toEqual(sampleGroups);
    expect(result.current.isUnavailable).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('preserves the unfiltered brand groups while a search is active', async () => {
    mocks.mockResolvedValueOnce(sampleGroups);
    mocks.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useRepairDevices());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setQuery('nokia'));
    await waitFor(() => expect(result.current.groups).toEqual([]));

    expect(result.current.brandGroups).toEqual(sampleGroups);
  });

  it('marks the catalogue unavailable on RepairCatalogUnavailableError', async () => {
    const { RepairCatalogUnavailableError } = jest.requireMock(
      '@/lib/repair-catalog-client'
    ) as { RepairCatalogUnavailableError: new () => Error };
    mocks.mockRejectedValueOnce(new RepairCatalogUnavailableError());

    const { result } = renderHook(() => useRepairDevices());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isUnavailable).toBe(true);
    expect(result.current.groups).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a generic error message on other failures', async () => {
    mocks.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() => useRepairDevices());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('network down');
    expect(result.current.isUnavailable).toBe(false);
  });

  it('shows a retryable timeout message when the catalogue request stalls', async () => {
    const { RepairCatalogTimeoutError } = jest.requireMock(
      '@/lib/repair-catalog-client'
    ) as { RepairCatalogTimeoutError: new () => Error };
    mocks.mockRejectedValueOnce(new RepairCatalogTimeoutError());

    const { result } = renderHook(() => useRepairDevices());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe(
      'Repair options took too long to load. Please try again.'
    );
  });

  it('refetches with the trimmed search query when setQuery is called', async () => {
    mocks.mockResolvedValueOnce(sampleGroups);
    mocks.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useRepairDevices());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setQuery('iphone');
    });

    await waitFor(() => expect(mocks).toHaveBeenCalledTimes(2));
    expect(mocks).toHaveBeenLastCalledWith('iphone', expect.anything());
  });
});
