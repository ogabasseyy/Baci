import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { useLegacyFundingUnconfirmed } from './use-legacy-funding-unconfirmed';

let mockCapability: boolean | null = null;
jest.mock('@/lib/piggyvest-primary-capability', () => ({
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

  it('never holds a PiggyVest account', () => {
    const { result } = renderHook(() =>
      useLegacyFundingUnconfirmed('piggyvest')
    );
    expect(result.current).toBe(false);
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
