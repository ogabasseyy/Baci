import { MERCHANT_COUNTRIES } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import { getOrderDisplayTimeZone } from './get-order-display-time-zone';

describe('getOrderDisplayTimeZone', () => {
  it.each(
    MERCHANT_COUNTRIES
  )('resolves the code and name for $name', (country) => {
    const zone = getOrderDisplayTimeZone(country.code);
    expect(zone).toBeDefined();
    expect(getOrderDisplayTimeZone(country.name)).toBe(zone);
    expect(
      () => new Intl.DateTimeFormat('en-NG', { timeZone: zone })
    ).not.toThrow();
  });

  it.each([
    [' ng ', 'Africa/Lagos'],
    ['nigeria', 'Africa/Lagos'],
    ['UK', 'Europe/London'],
    ['USA', 'America/New_York'],
    ["Cote d'Ivoire", 'Africa/Abidjan'],
    ['Ivory Coast', 'Africa/Abidjan'],
  ])('resolves the existing country alias %s', (country, expected) => {
    expect(getOrderDisplayTimeZone(country)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    'unknown',
  ])('does not guess for %s', (country) => {
    expect(getOrderDisplayTimeZone(country)).toBeUndefined();
  });
});
