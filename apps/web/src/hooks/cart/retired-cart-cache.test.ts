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
  expect(localStorage.getItem('baci-cart')).toBeNull();
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
