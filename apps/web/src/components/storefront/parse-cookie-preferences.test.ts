import { describe, expect, it } from 'vitest';
import { parseCookiePreferences } from './parse-cookie-preferences';

const preferences = {
  necessary: true,
  analytics: false,
  marketing: true,
  functional: false,
};
describe('parseCookiePreferences', () => {
  it('accepts a complete boolean choice with its persisted timestamp', () => {
    expect(
      parseCookiePreferences({
        ...preferences,
        timestamp: '2026-10-25T00:00:00Z',
      })
    ).toEqual(preferences);
  });
  it.each([
    null,
    [],
    true,
    'false',
    1,
    {},
  ])('rejects values without a complete preference object: %s', (value) => {
    expect(parseCookiePreferences(value)).toBeNull();
  });
  it.each([
    'necessary',
    'analytics',
    'marketing',
    'functional',
  ])('rejects nonboolean %s even when other flags are valid', (category) => {
    expect(
      parseCookiePreferences({ ...preferences, [category]: 'false' })
    ).toBeNull();
    expect(
      parseCookiePreferences({ ...preferences, [category]: undefined })
    ).toBeNull();
  });
});
