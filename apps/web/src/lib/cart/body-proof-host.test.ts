import { expect, it } from 'vitest';
import { requestUsesSharedPlatformHost } from './body-proof-host';

it('allows body proofs only on API, root, and local hosts', () => {
  for (const url of [
    'https://usebaci.com/api/storefront/cart/bootstrap',
    'https://www.usebaci.com/api/storefront/cart/bootstrap',
    'https://api.usebaci.com/api/storefront/cart/bootstrap',
    'https://api-staging.usebaci.com/api/storefront/cart/bootstrap',
    'http://localhost:3000/api/storefront/cart/bootstrap',
    'http://127.0.0.1:3000/api/storefront/cart/bootstrap',
  ]) {
    expect(requestUsesSharedPlatformHost(new Request(url))).toBe(true);
  }
});

it('keeps body proofs off merchant and arbitrary deployment hosts', () => {
  for (const url of [
    'https://ogabassey.usebaci.com/api/storefront/cart/bootstrap',
    'https://shop.example.com/api/storefront/cart/bootstrap',
    'https://baci-git-shared-cart-ogabassey.vercel.app/api/storefront/cart/bootstrap',
    'https://vercel.app/api/storefront/cart/bootstrap',
  ]) {
    expect(requestUsesSharedPlatformHost(new Request(url))).toBe(false);
  }
});
