import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { usePiggyvestCapabilityNow } from './use-piggyvest-capability-now';

jest.mock('@/lib/piggyvest-primary-capability', () => ({
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
