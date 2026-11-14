import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  clearObservedPiggyvestPrimaryCapability,
  msUntilNegativeCapabilityExpires,
  NEGATIVE_CAPABILITY_TTL_MS,
  observePiggyvestPrimaryCapability,
  readObservedPiggyvestPrimaryCapability,
  wasPiggyvestLastRuledOut,
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

describe('wasPiggyvestLastRuledOut', () => {
  it('stays true after the ruling-out expires, until a positive verdict replaces it', () => {
    const merchant = 'ruled-out-merchant';
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    observePiggyvestPrimaryCapability(merchant, false);
    clock.mockReturnValue(now + NEGATIVE_CAPABILITY_TTL_MS + 1);

    expect(readObservedPiggyvestPrimaryCapability(merchant)).toBeNull();
    expect(wasPiggyvestLastRuledOut(merchant)).toBe(true);

    observePiggyvestPrimaryCapability(merchant, true);
    expect(wasPiggyvestLastRuledOut(merchant)).toBe(false);
    clock.mockRestore();
  });

  it('is false for a merchant never observed', () => {
    expect(wasPiggyvestLastRuledOut('never-seen-merchant')).toBe(false);
  });
});
