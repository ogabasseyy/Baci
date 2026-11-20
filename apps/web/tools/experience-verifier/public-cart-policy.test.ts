import { describe, expect, it } from 'vitest';
import { createPublicCartPolicy } from './public-cart-policy';

const productId = '10000000-0000-4000-8000-000000000001';
const variantId = '20000000-0000-4000-8000-000000000002';
const cartId = '30000000-0000-4000-8000-000000000003';
const origin = 'https://shop.example.com';
const policy = () =>
  createPublicCartPolicy({
    origin,
    merchantSlug: 'synthetic',
    productId,
    variantId,
  });
const request = (path: string, body?: unknown) => ({
  url: `${origin}${path}`,
  method: body === undefined ? 'GET' : 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('public browser cart relay policy', () => {
  it('allows launch renewal only for the bound build and selected route', () => {
    const buildDigest = 'a'.repeat(64);
    const check = createPublicCartPolicy({
      origin,
      merchantSlug: 'synthetic',
      productId,
      launch: { buildDigest, paths: ['/', '/products/device'] },
    });
    const path = `/api/storefront/experience/launch?merchantSlug=synthetic&buildDigest=${buildDigest}&path=%2Fproducts%2Fdevice`;
    const body = { buildDigest, path: '/products/device' };
    expect(check(request(path, body))).toBe(true);
    for (const candidate of [
      request(path, { ...body, buildDigest: 'b'.repeat(64) }),
      request(path, { ...body, path: '/' }),
      request(path, { ...body, extra: true }),
      request(path.replace('synthetic', 'other'), body),
      request(`${path}&extra=1`, body),
      request(path.replace('%2Fproducts%2Fdevice', '%2Fadmin'), {
        ...body,
        path: '/admin',
      }),
      request(path),
    ])
      expect(check(candidate)).toBe(false);
    expect(policy()(request(path, body))).toBe(false);
  });
  it('allows only bounded cart operations for the selected product and merchant', () => {
    const check = policy();
    expect(check(request('/api/csrf'))).toBe(true);
    expect(
      check(
        request('/api/storefront/cart/bootstrap', { merchantSlug: 'synthetic' })
      )
    ).toBe(true);
    expect(check(request('/api/storefront/cart?merchantSlug=synthetic'))).toBe(
      true
    );
    expect(
      check(request('/api/storefront/cart/continuity?merchantSlug=synthetic'))
    ).toBe(true);
    expect(
      check(
        request('/api/storefront/cart?merchantSlug=synthetic', {
          operationId: 'create-1',
          lines: [],
        })
      )
    ).toBe(true);
    expect(
      check(
        request('/api/storefront/cart/commands?merchantSlug=synthetic', {
          operationId: 'add-1',
          expectedVersion: 1,
          command: { type: 'add', item: { productId, variantId }, quantity: 1 },
        })
      )
    ).toBe(true);
    expect(
      check(
        request('/api/storefront/cart/checkout?merchantSlug=synthetic', {
          operationId: 'review-1',
          expectedVersion: 2,
          cartId,
        })
      )
    ).toBe(true);
  });
  it('denies other origins, merchants, methods, orders, payments and path tricks', () => {
    const check = policy();
    for (const input of [
      request('/api/orders', {}),
      request('/api/payments', {}),
      request('/api/storefront/cart/checkout/../orders', {}),
      request('/api/storefront/cart?merchantSlug=other'),
      request('/api/storefront/cart?merchantSlug=synthetic&merchantSlug=other'),
      request('/api/storefront/cart?unexpected=1'),
      {
        ...request('/api/storefront/cart'),
        url: 'https://other.example.com/api/storefront/cart',
      },
      { ...request('/api/storefront/cart'), method: 'DELETE' },
      { ...request('/api/storefront/cart'), body: '{}' },
    ])
      expect(check(input)).toBe(false);
  });
  it('rejects foreign products, bulk quantities, attachments, recovery and malformed bodies', () => {
    const check = policy();
    const command = (item: unknown, quantity = 1, extra = {}) =>
      request('/api/storefront/cart/commands', {
        operationId: 'add',
        expectedVersion: 1,
        command: { type: 'add', item, quantity, ...extra },
      });
    for (const input of [
      command({ productId: cartId, variantId }),
      command({ productId }),
      command({ productId, variantId }, 2),
      command({ productId, variantId }, 1, { voucherToken: 'secret' }),
      request('/api/storefront/cart', {
        operationId: 'x',
        lines: [{ item: { productId, variantId }, quantity: 2 }],
      }),
      request('/api/storefront/cart/checkout', {
        operationId: 'x',
        expectedVersion: 1,
        cartId,
        recoveryForRedvault: true,
      }),
      { url: `${origin}/api/storefront/cart`, method: 'POST', body: '{' },
      {
        url: `${origin}/api/storefront/cart`,
        method: 'POST',
        body: 'x'.repeat(8193),
      },
    ])
      expect(check(input)).toBe(false);
  });
  it('supports products without variants and refuses an untrusted configuration', () => {
    const check = createPublicCartPolicy({
      origin,
      merchantSlug: 'synthetic',
      productId,
    });
    expect(
      check(
        request('/api/storefront/cart/commands', {
          operationId: 'add-1',
          expectedVersion: 1,
          command: { type: 'add', item: { productId }, quantity: 1 },
        })
      )
    ).toBe(true);
    expect(
      check(
        request('/api/storefront/cart/commands', {
          operationId: 'add-1',
          expectedVersion: 1,
          command: { type: 'add', item: { productId, variantId }, quantity: 1 },
        })
      )
    ).toBe(false);
    expect(() =>
      createPublicCartPolicy({
        origin: 'http://127.0.0.1',
        merchantSlug: 'synthetic',
        productId,
      })
    ).toThrow();
  });
});
