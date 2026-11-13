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
    observePiggyvestPrimaryCapability(
      '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      false
    );
    jest.setSystemTime(1_000_000 + NEGATIVE_CAPABILITY_TTL_MS);

    // Act + Assert
    expect(isPiggyvestPossibleNow('6b5cb8a4-5575-456c-b936-8cdfae30db74')).toBe(
      true
    );
  });

  it('is possible for an enabled merchant or the unprobed pilot only', () => {
    observePiggyvestPrimaryCapability('merchant-1', true);
    expect(isPiggyvestPossibleNow('merchant-1')).toBe(true);
    expect(isPiggyvestPossibleNow('6b5cb8a4-5575-456c-b936-8cdfae30db74')).toBe(
      true
    );
    // Owner decision 2026-11-13: any other unprobed merchant is legacy.
    expect(isPiggyvestPossibleNow('merchant-2')).toBe(false);
  });

  it('is false with no merchant at all, like the hook', () => {
    expect(isPiggyvestPossibleNow('')).toBe(false);
  });
});
