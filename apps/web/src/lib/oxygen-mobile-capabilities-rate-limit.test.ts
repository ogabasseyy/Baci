import { expect, it, vi } from 'vitest';
import { checkOxygenMobileCapabilitiesRateLimit } from './oxygen-mobile-capabilities-rate-limit';
import { __resetRateLimitStoreForTesting } from './rate-limit';

vi.mock('./redis', () => ({ getRedis: () => null }));

it('keeps the read-only capability check available with a bounded per-customer fallback when Redis is down', async () => {
  __resetRateLimitStoreForTesting();
  for (let index = 0; index < 10; index++) {
    expect(
      (await checkOxygenMobileCapabilitiesRateLimit('customer-a')).allowed
    ).toBe(true);
  }
  expect(
    (await checkOxygenMobileCapabilitiesRateLimit('customer-a')).allowed
  ).toBe(false);
  expect(
    (await checkOxygenMobileCapabilitiesRateLimit('customer-b')).allowed
  ).toBe(true);
  __resetRateLimitStoreForTesting();
});
