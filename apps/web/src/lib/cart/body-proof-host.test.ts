import { expect, it } from 'vitest';
import { requestUsesSharedPlatformHost } from './body-proof-host';

it('allows body proofs only on API and local hosts', () => {
  for (const url of [
    'https://api.usebaci.com/api/storefront/cart/bootstrap',
    'https://api-staging.usebaci.com/api/storefront/cart/bootstrap',
    'http://localhost:3000/api/storefront/cart/bootstrap',
    'http://127.0.0.1:3000/api/storefront/cart/bootstrap',
    'http://192.168.100.70:4193/api/storefront/cart/bootstrap',
    'http://10.0.0.5:4193/api/storefront/cart/bootstrap',
    'http://172.16.0.5:4193/api/storefront/cart/bootstrap',
  ]) {
    expect(requestUsesSharedPlatformHost(new Request(url))).toBe(true);
  }
});

it('rejects look-alike LAN hostnames', () => {
  for (const url of [
    'http://192.168.100.70.evil.test/api/storefront/cart/bootstrap',
    'http://172.32.0.5:4193/api/storefront/cart/bootstrap',
  ]) {
    expect(requestUsesSharedPlatformHost(new Request(url))).toBe(false);
  }
});

it('keeps body proofs off local hosts in production', () => {
  for (const url of [
    'http://localhost:3000/api/storefront/cart/bootstrap',
    'http://127.0.0.1:3000/api/storefront/cart/bootstrap',
    'http://192.168.100.70:4193/api/storefront/cart/bootstrap',
    'http://10.0.0.5:4193/api/storefront/cart/bootstrap',
  ]) {
    expect(
      requestUsesSharedPlatformHost(new Request(url), undefined, 'production')
    ).toBe(false);
  }
  // The programmatic production API surface still receives body proofs.
  expect(
    requestUsesSharedPlatformHost(
      new Request('https://api.usebaci.com/api/storefront/cart/bootstrap'),
      undefined,
      'production'
    )
  ).toBe(true);
});

it('keeps body proofs off merchant and arbitrary deployment hosts', () => {
  for (const url of [
    'https://usebaci.com/api/storefront/cart/bootstrap',
    'https://www.usebaci.com/api/storefront/cart/bootstrap',
    'https://ogabassey.usebaci.com/api/storefront/cart/bootstrap',
    'https://shop.example.com/api/storefront/cart/bootstrap',
    'https://baci-git-shared-cart-ogabassey.vercel.app/api/storefront/cart/bootstrap',
    'https://vercel.app/api/storefront/cart/bootstrap',
  ]) {
    expect(requestUsesSharedPlatformHost(new Request(url))).toBe(false);
  }
});
