import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  clearObservedPiggyvestPrimaryCapability,
  msUntilNegativeCapabilityExpires,
  NEGATIVE_CAPABILITY_TTL_MS,
  observePiggyvestPrimaryCapability,
  readObservedPiggyvestPrimaryCapability,
} from './piggyvest-primary-capability-cache';

afterEach(() => {
  clearObservedPiggyvestPrimaryCapability();
  jest.useRealTimers();
});

describe('msUntilNegativeCapabilityExpires', () => {
  it('reports the remaining lifetime of a current ruling-out', () => {
    jest.useFakeTimers({ now: 1_000_000 });
    observePiggyvestPrimaryCapability('merchant-1', false);
    jest.setSystemTime(1_000_000 + 59_000);

    expect(msUntilNegativeCapabilityExpires('merchant-1')).toBe(
      NEGATIVE_CAPABILITY_TTL_MS - 59_000
    );
  });

  it('is null once expired, for a positive verdict, or with no verdict', () => {
    jest.useFakeTimers({ now: 1_000_000 });
    observePiggyvestPrimaryCapability('merchant-1', false);
    jest.setSystemTime(1_000_000 + NEGATIVE_CAPABILITY_TTL_MS);
    expect(msUntilNegativeCapabilityExpires('merchant-1')).toBeNull();
    expect(readObservedPiggyvestPrimaryCapability('merchant-1')).toBeNull();

    observePiggyvestPrimaryCapability('merchant-2', true);
    expect(msUntilNegativeCapabilityExpires('merchant-2')).toBeNull();
    expect(msUntilNegativeCapabilityExpires('merchant-3')).toBeNull();
  });
});
