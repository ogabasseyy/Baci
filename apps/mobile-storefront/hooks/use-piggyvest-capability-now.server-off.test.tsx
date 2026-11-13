import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { usePiggyvestCapabilityNow } from './use-piggyvest-capability-now';

// merchant-1 stands in for the Ogabassey pilot: owner decision 2026-11-13,
// PiggyVest (and its unknown-verdict holds) is only for that merchant.
jest.mock('@/lib/is-piggyvest-primary-merchant', () => {
  const actual = jest.requireActual<
    typeof import('@/lib/is-piggyvest-primary-merchant')
  >('@/lib/is-piggyvest-primary-merchant');
  return {
    isPiggyvestPrimaryMerchant: (id?: string | null) =>
      id === 'merchant-1' || actual.isPiggyvestPrimaryMerchant(id),
  };
});

const mockProbe = jest.fn(async (_merchantId: string) => true);
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  getPiggyvestPrimaryCapability: (merchantId: string) => mockProbe(merchantId),
  usePiggyvestPrimaryCapability: () => false,
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: '' } }));

afterEach(() => {
  clearObservedPiggyvestPrimaryCapability();
  jest.useRealTimers();
});

describe('server keeps PiggyVest off', () => {
  it('reads the current ruling-out', () => {
    observePiggyvestPrimaryCapability('merchant-1', false);
    const { result } = renderHook(() =>
      usePiggyvestCapabilityNow('merchant-1')
    );
    expect(result.current).toBe(false);
  });
});

describe('bugfix: stale ruling-out kept after its real expiry', () => {
  it('turns unknown exactly when the cached ruling-out expires', () => {
    // Arrange: ruled out 59 s before the screen mounts.
    jest.useFakeTimers({ now: 1_000_000 });
    observePiggyvestPrimaryCapability('merchant-1', false);
    jest.setSystemTime(1_000_000 + 59_000);
    const { result } = renderHook(() =>
      usePiggyvestCapabilityNow('merchant-1')
    );
    expect(result.current).toBe(false);

    // Act: advance through the remaining second.
    act(() => {
      jest.advanceTimersByTime(1_100);
    });

    // Assert
    expect(result.current).toBeNull();
  });
});

describe('bugfix: render verdict kept after a positive verdict was rolled back', () => {
  it('re-renders to "ruled out" when a mounted flow rolls the cache back', () => {
    // Arrange: PiggyVest confirmed while the screen is mounted.
    observePiggyvestPrimaryCapability('merchant-1', true);
    const { result } = renderHook(() =>
      usePiggyvestCapabilityNow('merchant-1')
    );
    expect(result.current).toBe(true);

    // Act: a funding call answers NOT_READY and rolls the verdict back.
    act(() => {
      observePiggyvestPrimaryCapability('merchant-1', false);
    });

    // Assert
    expect(result.current).toBe(false);
  });
});

describe('bugfix: verdict left unknown after a rollback expires', () => {
  it('asks the server again when the rolled-back ruling-out expires', () => {
    // Arrange: a mounted flow rolled the verdict back to "not ready" 59 s
    // ago; the nested hook still holds its earlier verdict.
    jest.useFakeTimers({ now: 1_000_000 });
    observePiggyvestPrimaryCapability('merchant-1', false);
    jest.setSystemTime(1_000_000 + 59_000);
    mockProbe.mockClear();
    renderHook(() => usePiggyvestCapabilityNow('merchant-1'));

    // Act: advance through the expiry boundary.
    act(() => {
      jest.advanceTimersByTime(1_100);
    });

    // Assert: a fresh verdict is requested at the boundary.
    expect(mockProbe).toHaveBeenCalledWith('merchant-1');
  });
});
