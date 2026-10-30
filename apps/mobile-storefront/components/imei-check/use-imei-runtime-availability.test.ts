import type {
  fetchRuntimeImeiTierKeys,
  ImeiServiceTierKey,
} from '@baci/shared/imei';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useImeiRuntimeAvailability } from './use-imei-runtime-availability';

const mockFetchKeys = jest.fn<typeof fetchRuntimeImeiTierKeys>();
jest.mock('@baci/shared/imei', () => ({
  fetchRuntimeImeiTierKeys: (
    ...args: Parameters<typeof fetchRuntimeImeiTierKeys>
  ) => mockFetchKeys(...args),
}));
const fetchKeys = mockFetchKeys;

describe('native IMEI runtime availability', () => {
  beforeEach(() => {
    fetchKeys.mockReset();
  });
  it('renders immediately with unknown capabilities, then exposes only a validated response', async () => {
    fetchKeys.mockResolvedValue(['esimCompatibility']);
    const { result } = renderHook(() =>
      useImeiRuntimeAvailability('smartphone')
    );
    expect(result.current.availableTierKeys).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() =>
      expect(result.current.availableTierKeys).toEqual(['esimCompatibility'])
    );
  });
  it('preserves explicit empty capabilities and permits retry after an error', async () => {
    fetchKeys.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('405'));
    const { result } = renderHook(() =>
      useImeiRuntimeAvailability('smartphone')
    );
    await waitFor(() => expect(result.current.availableTierKeys).toEqual([]));
    act(() => result.current.retry());
    expect(result.current.availableTierKeys).toBeNull();
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.availableTierKeys).toBeNull();
  });
  it('ignores an out-of-order response from a stale device request', async () => {
    let resolvePhone: ((keys: ImeiServiceTierKey[]) => void) | undefined;
    let resolveTablet: ((keys: ImeiServiceTierKey[]) => void) | undefined;
    fetchKeys
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePhone = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTablet = resolve;
          })
      );
    const { result, rerender } = renderHook(
      ({ device }: { device: 'smartphone' | 'tablet' }) =>
        useImeiRuntimeAvailability(device),
      { initialProps: { device: 'smartphone' } }
    );
    rerender({ device: 'tablet' });
    await act(async () => {
      resolveTablet?.([]);
    });
    expect(result.current.availableTierKeys).toEqual([]);
    await act(async () => {
      resolvePhone?.(['esimCompatibility']);
    });
    expect(result.current.availableTierKeys).toEqual([]);
    expect(fetchKeys.mock.calls[0]?.[0].signal?.aborted).toBe(true);
  });
});
