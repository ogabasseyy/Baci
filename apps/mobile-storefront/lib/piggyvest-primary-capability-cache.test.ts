import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
  readObservedPiggyvestPrimaryCapability,
} from './piggyvest-primary-capability-cache';

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-08T12:00:00Z'));
});

afterEach(() => {
  clearObservedPiggyvestPrimaryCapability();
  jest.useRealTimers();
});

it('retains a positive verdict past the negative TTL', () => {
  observePiggyvestPrimaryCapability('merchant-1', true);
  jest.advanceTimersByTime(3600_000);
  expect(readObservedPiggyvestPrimaryCapability('merchant-1')).toBe(true);
});

it('expires a negative verdict after 60s so newly-ready merchants probe again', () => {
  observePiggyvestPrimaryCapability('merchant-1', false);
  expect(readObservedPiggyvestPrimaryCapability('merchant-1')).toBe(false);
  jest.advanceTimersByTime(60_000);
  expect(readObservedPiggyvestPrimaryCapability('merchant-1')).toBeNull();
});

it('returns null for never-observed merchants', () => {
  expect(readObservedPiggyvestPrimaryCapability('merchant-1')).toBeNull();
});
