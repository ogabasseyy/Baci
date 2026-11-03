import { afterEach, expect, it, vi } from 'vitest';
import { isMarketingAllowed } from './marketing-consent';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each([
  null,
  'not-json',
  '{}',
  '{"marketing":true}',
  '{"necessary":true,"analytics":true,"marketing":"true","functional":true}',
])('fails closed for incomplete or invalid consent: %s', (raw) => {
  if (raw) localStorage.setItem('baci-cookie-consent', raw);
  expect(isMarketingAllowed()).toBe(false);
});
it('accepts a real marketing decision independently of analytics and reflects revocation', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: false,
      marketing: true,
      functional: false,
    })
  );
  expect(isMarketingAllowed()).toBe(true);
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  expect(isMarketingAllowed()).toBe(false);
});
it('does not access storage on the server', () => {
  vi.stubGlobal('window', undefined);
  expect(isMarketingAllowed()).toBe(false);
});
it('fails closed when storage is inaccessible', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('private');
  });
  expect(isMarketingAllowed()).toBe(false);
});
