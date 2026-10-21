import { expect, it, vi } from 'vitest';
import { eraseRetiredCartCache } from './retired-cart-cache';

it('erases merchant account and guest payloads without clearing sibling merchant caches', () => {
  localStorage.clear();
  const user = '11111111-1111-4111-8111-111111111111';
  const otherUser = '22222222-2222-4222-8222-222222222222';
  for (const key of [
    `baci-cart-shop-${user}`,
    `baci-cart-shop-${otherUser}`,
    'baci-cart-shop-guest',
    'baci-cart-shop-group-negotiation',
    'baci-cart-shop-shared-import',
    `baci-cart-shop-extra-${user}`,
    'baci-cart-other-guest',
    'baci-cart-other-group-negotiation',
    'baci-cart',
    'baci-cart-guest',
  ])
    localStorage.setItem(key, 'saved');
  eraseRetiredCartCache('shop', user);
  expect(localStorage.getItem(`baci-cart-shop-${user}`)).toBeNull();
  // Another account's parked cart on the same merchant survives.
  expect(localStorage.getItem(`baci-cart-shop-${otherUser}`)).toBe('saved');
  expect(localStorage.getItem('baci-cart-shop-guest')).toBeNull();
  expect(localStorage.getItem('baci-cart-shop-group-negotiation')).toBeNull();
  expect(localStorage.getItem('baci-cart-shop-shared-import')).toBeNull();
  expect(localStorage.getItem(`baci-cart-shop-extra-${user}`)).toBe('saved');
  expect(localStorage.getItem('baci-cart-other-guest')).toBe('saved');
  expect(localStorage.getItem('baci-cart-other-group-negotiation')).toBe(
    'saved'
  );
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
it('clears the guest cache during passive revocation before releasing pending authority', async () => {
  const { fetchWithCsrf } = await import('@/lib/api-client');
  const revoke = await import('./shared-cart-session-revoke-client');
  const userKey = 'baci-cart-shop-11111111-1111-4111-8111-111111111111';
  localStorage.setItem(userKey, 'private-test-cache');
  localStorage.setItem('baci-cart-shop-guest', 'guest-cache');
  revoke.markCartDeviceRevocationPending('shop');
  vi.mocked(fetchWithCsrf).mockResolvedValue(
    new Response(JSON.stringify({ revoked: true }))
  );
  await expect(revoke.ensureCartDeviceRevocationCleared('shop')).resolves.toBe(
    true
  );
  expect(localStorage.getItem('baci-cart-shop-guest')).toBeNull();
  // Without a retiring user ID, other accounts' parked carts survive;
  // only the guest payload provisioning reads is erased.
  expect(localStorage.getItem(userKey)).toBe('private-test-cache');
});

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));
