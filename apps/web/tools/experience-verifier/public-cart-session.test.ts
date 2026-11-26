import { describe, expect, it, vi } from 'vitest';
import { createPublicCartSession } from './public-cart-session';

const origin = 'https://shop.example.com';
const merchantId = '10000000-0000-4000-8000-000000000001';
const productId = '20000000-0000-4000-8000-000000000002';
const token = 'x'.repeat(43);
const csrf = `__Host-csrf-token=${token}; Path=/; Secure; SameSite=Lax`;
const cart = `baci-cart-${merchantId}=opaque-proof; Path=/; Secure; HttpOnly; SameSite=Lax`;
const input = (path: string, body?: unknown) => ({
  url: `${origin}${path}`,
  method: body === undefined ? 'GET' : 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('isolated public cart session', () => {
  it('accepts the expiry attributes emitted by the Next.js cookie serializer', async () => {
    const future = new Date(Date.now() + 60000).toUTCString();
    const network = vi.fn(async () => ({
      status: 200,
      body: Buffer.from('{}'),
      cookies: [`${csrf}; Expires=${future}; Max-Age=60`],
    }));
    const session = createPublicCartSession({
      origin,
      merchantId,
      merchantSlug: 'synthetic',
      productId,
      network,
    });
    await expect(session(input('/api/csrf'))).resolves.toMatchObject({
      status: 200,
    });
  });
  it('keeps csrf and cart cookies host-side and sends only fixed headers', async () => {
    const network = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: Buffer.from('{}'),
        cookies: [csrf],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: Buffer.from('{}'),
        cookies: [cart],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: Buffer.from('{"cart":{}}'),
        cookies: [],
      });
    const session = createPublicCartSession({
      origin,
      merchantId,
      merchantSlug: 'synthetic',
      productId,
      network,
    });
    await session(input('/api/csrf'));
    const boot = await session(
      input('/api/storefront/cart/bootstrap', { merchantSlug: 'synthetic' })
    );
    await session(input('/api/storefront/cart'));
    expect(boot).toEqual({ status: 200, body: '{}' });
    expect(network.mock.calls[1][0].headers).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
      cookie: `__Host-csrf-token=${token}`,
      origin,
      'x-csrf-token': token,
    });
    expect(network.mock.calls[2][0].headers.cookie).toContain(
      `baci-cart-${merchantId}=opaque-proof`
    );
    expect(network.mock.calls[2][0].headers['x-baci-cart-probe']).toBe('1');
  });
  it('fails closed on prohibited requests, unsafe cookies, redirects and missing CSRF', async () => {
    const network = vi
      .fn()
      .mockResolvedValue({ status: 200, body: Buffer.from('{}'), cookies: [] });
    const session = createPublicCartSession({
      origin,
      merchantId,
      merchantSlug: 'synthetic',
      productId,
      network,
    });
    await expect(session(input('/api/orders', {}))).rejects.toThrow();
    await expect(
      session(input('/api/storefront/cart/bootstrap', {}))
    ).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
    for (const bad of [
      `__Host-csrf-token=${token}; Domain=example.com; Path=/; Secure`,
      `__Host-csrf-token=${token}; Path=/`,
      `__Host-csrf-token=${token}; Path=/; Secure; Max-Age=0`,
    ]) {
      const unsafe = createPublicCartSession({
        origin,
        merchantId,
        merchantSlug: 'synthetic',
        productId,
        network: async () => ({
          status: 200,
          body: Buffer.from('{}'),
          cookies: [bad],
        }),
      });
      await expect(unsafe(input('/api/csrf'))).rejects.toThrow();
    }
    const redirect = createPublicCartSession({
      origin,
      merchantId,
      merchantSlug: 'synthetic',
      productId,
      network: async () => ({
        status: 302,
        body: Buffer.from(''),
        cookies: [],
      }),
    });
    await expect(redirect(input('/api/csrf'))).rejects.toThrow();
  });
  it('rejects concurrent requests and consumes a bounded request allowance', async () => {
    let release!: () => void;
    const network = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { status: 200, body: Buffer.from('{}'), cookies: [] };
    });
    const session = createPublicCartSession({
      origin,
      merchantId,
      merchantSlug: 'synthetic',
      productId,
      network,
      maxRequests: 1,
    });
    const first = session(input('/api/storefront/cart'));
    await expect(session(input('/api/storefront/cart'))).rejects.toThrow();
    release();
    await first;
    await expect(session(input('/api/storefront/cart'))).rejects.toThrow();
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('never forwards a proof from an upstream response body', async () => {
    const network = vi.fn(async () => ({
      status: 200,
      body: Buffer.from('{"data":{"proof":"secret"}}'),
      cookies: [cart],
    }));
    const session = createPublicCartSession({
      origin,
      merchantId,
      merchantSlug: 'synthetic',
      productId,
      network,
    });
    await expect(session(input('/api/storefront/cart'))).rejects.toThrow(
      'PUBLIC_CART_PROOF_IN_BODY'
    );
    await expect(session(input('/api/storefront/cart'))).rejects.toThrow();
    expect(network).toHaveBeenCalledTimes(1);
  });
});
