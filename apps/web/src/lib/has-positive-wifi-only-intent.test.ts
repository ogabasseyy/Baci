import { describe, expect, it } from 'vitest';
import { hasPositiveWifiOnlyIntent } from './has-positive-wifi-only-intent';

describe('hasPositiveWifiOnlyIntent', () => {
  it.each([
    'not Wi-Fi Only',
    'without Wi-Fi Only',
    'avoid Wi-Fi Only',
    'exclude Wi-Fi Only',
    "don't show Wi-Fi Only",
    "iPhone that isn't Wi-Fi only",
    'iPhone that isn’t Wi-Fi only',
    'iPhone anything but Wi-Fi only',
    'iPhone other than Wi-Fi only',
  ])('does not infer positive intent from negated query %s', (query) => {
    expect(hasPositiveWifiOnlyIntent(query)).toBe(false);
  });

  it.each([
    'iPhone Wi-Fi Only',
    'iPad wi-fi only',
    'tablet Wi-Fi-Only 128GB',
  ])('infers positive intent from unnegated query %s', (query) => {
    expect(hasPositiveWifiOnlyIntent(query)).toBe(true);
  });

  it('returns false when query does not mention wi-fi only', () => {
    expect(hasPositiveWifiOnlyIntent('iPhone 16 Pro')).toBe(false);
    expect(hasPositiveWifiOnlyIntent('Samsung Galaxy S24')).toBe(false);
  });
});
