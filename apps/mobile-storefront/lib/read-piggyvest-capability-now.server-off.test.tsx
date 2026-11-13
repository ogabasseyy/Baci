import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { readPiggyvestCapabilityNow } from './read-piggyvest-capability-now';

jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: '' } }));

afterEach(() => {
  clearObservedPiggyvestPrimaryCapability();
});

describe('readPiggyvestCapabilityNow', () => {
  it('is false while the server ruling-out is current', () => {
    observePiggyvestPrimaryCapability('merchant-1', false);
    expect(readPiggyvestCapabilityNow('merchant-1')).toBe(false);
  });

  it('is true once the server confirms PiggyVest', () => {
    observePiggyvestPrimaryCapability('merchant-1', true);
    expect(readPiggyvestCapabilityNow('merchant-1')).toBe(true);
  });

  it('is unknown (null) before any verdict for the Ogabassey pilot', () => {
    expect(
      readPiggyvestCapabilityNow('6b5cb8a4-5575-456c-b936-8cdfae30db74')
    ).toBeNull();
  });

  it('owner decision: counts an unknown verdict as ruled out for any other merchant', () => {
    expect(readPiggyvestCapabilityNow('merchant-1')).toBe(false);
  });

  it('is false with no merchant at all', () => {
    expect(readPiggyvestCapabilityNow('')).toBe(false);
  });
});
