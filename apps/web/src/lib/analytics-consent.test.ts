import { afterEach, expect, it, vi } from 'vitest';
import { isAnalyticsAllowed } from './analytics-consent';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
it.each([
  null,
  'not-json',
  '{}',
  '{"analytics":false}',
  '{"analytics":true}',
  '{"analytics":"true"}',
  '{"analytics":1}',
  'null',
])('fails closed for absent or invalid consent: %s', (stored) => {
  if (stored !== null) localStorage.setItem('baci-cookie-consent', stored);
  expect(isAnalyticsAllowed()).toBe(false);
});
it('accepts only an explicit stored analytics grant', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  expect(isAnalyticsAllowed()).toBe(true);
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({ analytics: false })
  );
  expect(isAnalyticsAllowed()).toBe(false);
});
it('fails closed when storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('unavailable');
  });
  expect(isAnalyticsAllowed()).toBe(false);
});
it('does not read browser consent during server rendering', () => {
  vi.stubGlobal('window', undefined);
  expect(isAnalyticsAllowed()).toBe(false);
});
