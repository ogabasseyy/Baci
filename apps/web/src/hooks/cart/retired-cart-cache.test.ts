import { expect, it, vi } from 'vitest';
import { eraseRetiredCartCache } from './retired-cart-cache';

it('erases merchant account and guest payloads without clearing sibling merchant caches', () => {
  localStorage.clear();
  const user = '11111111-1111-4111-8111-111111111111';
  for (const key of [
    `baci-cart-shop-${user}`,
    'baci-cart-shop-guest',
    `baci-cart-shop-extra-${user}`,
    'baci-cart-other-guest',
    'baci-cart',
    'baci-cart-guest',
  ])
    localStorage.setItem(key, 'saved');
  eraseRetiredCartCache('shop');
  expect(localStorage.getItem(`baci-cart-shop-${user}`)).toBeNull();
  expect(localStorage.getItem('baci-cart-shop-guest')).toBeNull();
  expect(localStorage.getItem(`baci-cart-shop-extra-${user}`)).toBe('saved');
  expect(localStorage.getItem('baci-cart-other-guest')).toBe('saved');
  // The merchant-less fallback belongs to no single merchant, so a
  // merchant-scoped retirement must preserve it.
  expect(localStorage.getItem('baci-cart')).toBe('saved');
  expect(localStorage.getItem('baci-cart-guest')).toBe('saved');
});

it('erases the merchant-less fallback only on a merchant-less retirement', () => {
  localStorage.clear();
  localStorage.setItem('baci-cart', 'saved');
  localStorage.setItem('baci-cart-guest', 'saved');
  localStorage.setItem('baci-cart-shop-guest', 'saved');
  eraseRetiredCartCache();
  expect(localStorage.getItem('baci-cart')).toBeNull();
  expect(localStorage.getItem('baci-cart-guest')).toBeNull();
  expect(localStorage.getItem('baci-cart-shop-guest')).toBe('saved');
});
it('clears the account cache during passive revocation before releasing pending authority', async () => {
  const { fetchWithCsrf } = await import('@/lib/api-client');
  const revoke = await import('./shared-cart-session-revoke-client');
  const userKey = 'baci-cart-shop-11111111-1111-4111-8111-111111111111';
  localStorage.setItem(userKey, 'private-test-cache');
  revoke.markCartDeviceRevocationPending('shop');
  vi.mocked(fetchWithCsrf).mockResolvedValue(
    new Response(JSON.stringify({ revoked: true }))
  );
  await expect(revoke.ensureCartDeviceRevocationCleared('shop')).resolves.toBe(
    true
  );
  expect(localStorage.getItem(userKey)).toBeNull();
});

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));
