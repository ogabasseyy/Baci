import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { useLegacyFundingUnconfirmed } from './use-legacy-funding-unconfirmed';

let mockCapability: boolean | null = null;
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  getPiggyvestPrimaryCapability: async () => false,
  usePiggyvestPrimaryCapability: () => mockCapability,
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: '' } }));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (state: { merchantId: string }) => unknown) =>
    select({ merchantId: 'merchant-1' }),
}));

afterEach(() => {
  clearObservedPiggyvestPrimaryCapability();
  mockCapability = null;
});

describe('bugfix: legacy account number shown before the PiggyVest verdict', () => {
  it('holds a legacy account while the verdict is unknown', () => {
    const { result } = renderHook(() =>
      useLegacyFundingUnconfirmed('paystack')
    );
    expect(result.current).toBe(true);
  });

  it('bugfix: holds a rolled-back PiggyVest account while the verdict is unknown', () => {
    // Arrange: rollback, failed wallet reload, ruling-out since expired:
    // the verdict is unknown while the re-probe is pending.
    const { result } = renderHook(() =>
      useLegacyFundingUnconfirmed('piggyvest')
    );

    // Assert: hidden until the verdict is positively true.
    expect(result.current).toBe(true);
  });
});

describe('bugfix: legacy account shown after the ruling-out expired', () => {
  it('holds as soon as the cached verdict expires, before the hook re-renders', () => {
    // Arrange: the hook still says "ruled out", but the cache has expired.
    mockCapability = false;

    // Act
    const { result } = renderHook(() =>
      useLegacyFundingUnconfirmed('paystack')
    );

    // Assert
    expect(result.current).toBe(true);
  });
});

describe('bugfix: legacy account shown under a positive verdict', () => {
  it('holds a legacy account once PiggyVest is confirmed, until reclassified', () => {
    mockCapability = true;
    observePiggyvestPrimaryCapability('merchant-1', true);
    const { result } = renderHook(() =>
      useLegacyFundingUnconfirmed('paystack')
    );
    expect(result.current).toBe(true);
  });
});

describe('server keeps PiggyVest off', () => {
  it('shows the legacy account once PiggyVest is ruled out', () => {
    mockCapability = false;
    observePiggyvestPrimaryCapability('merchant-1', false);
    const { result } = renderHook(() =>
      useLegacyFundingUnconfirmed('paystack')
    );
    expect(result.current).toBe(false);
  });
});

describe('bugfix: legacy account kept visible after the real expiry', () => {
  it('hides the account at the cached ruling-out expiry, not a full TTL later', () => {
    // Arrange: a ruling-out observed 59 s ago, screen mounts now.
    jest.useFakeTimers({ now: 1_000_000 });
    observePiggyvestPrimaryCapability('merchant-1', false);
    jest.setSystemTime(1_000_000 + 59_000);
    mockCapability = false;
    const { result } = renderHook(() =>
      useLegacyFundingUnconfirmed('paystack')
    );
    expect(result.current).toBe(false);

    // Act: advance through the real expiry (1 s left).
    act(() => {
      jest.advanceTimersByTime(1_100);
    });

    // Assert
    expect(result.current).toBe(true);
    jest.useRealTimers();
  });
});

describe('bugfix: PiggyVest account shown after a rollback to not ready', () => {
  it('hides a PiggyVest account while the server rules PiggyVest out', () => {
    // Arrange: rolled back; the reload hasn't replaced the cached account
    // (it may have failed).
    mockCapability = false;
    observePiggyvestPrimaryCapability('merchant-1', false);

    // Act
    const { result } = renderHook(() =>
      useLegacyFundingUnconfirmed('piggyvest')
    );

    // Assert
    expect(result.current).toBe(true);
  });

  it('shows a PiggyVest account once PiggyVest is confirmed', () => {
    mockCapability = true;
    observePiggyvestPrimaryCapability('merchant-1', true);
    const { result } = renderHook(() =>
      useLegacyFundingUnconfirmed('piggyvest')
    );
    expect(result.current).toBe(false);
  });
});
