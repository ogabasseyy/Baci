import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  clearObservedPiggyvestPrimaryCapability,
  NEGATIVE_CAPABILITY_TTL_MS,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { isPiggyvestPossibleNow } from './is-piggyvest-possible-now';

jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: '' } }));

afterEach(() => {
  clearObservedPiggyvestPrimaryCapability();
  jest.useRealTimers();
});

describe('isPiggyvestPossibleNow', () => {
  it('is false while the server ruling-out is current', () => {
    observePiggyvestPrimaryCapability('merchant-1', false);
    expect(isPiggyvestPossibleNow('merchant-1')).toBe(false);
  });

  it('bugfix: is possible again once the cached ruling-out has expired', () => {
    // Arrange: ruled out, then the negative TTL passes mid-session.
    jest.useFakeTimers({ now: 1_000_000 });
    observePiggyvestPrimaryCapability('merchant-1', false);
    jest.setSystemTime(1_000_000 + NEGATIVE_CAPABILITY_TTL_MS);

    // Act + Assert
    expect(isPiggyvestPossibleNow('merchant-1')).toBe(true);
  });

  it('is possible for an enabled or unprobed merchant', () => {
    observePiggyvestPrimaryCapability('merchant-1', true);
    expect(isPiggyvestPossibleNow('merchant-1')).toBe(true);
    expect(isPiggyvestPossibleNow('merchant-2')).toBe(true);
  });

  it('is false with no merchant at all, like the hook', () => {
    expect(isPiggyvestPossibleNow('')).toBe(false);
  });
});
