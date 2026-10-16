import { describe, expect, it, vi } from 'vitest';
import { createGuestCanonicalBridge } from './guest-cart-canonical-bridge';
const endpoint = 'https://ogabassey.com/api/storefront/cart/legacy';
const token = 'a'.repeat(64);
const state = {
  cartId: '11111111-1111-4111-8111-111111111111',
  version: 4,
  expiresAt: '2099-01-01T00:00:00Z',
  lines: [{ productId: '22222222-2222-4222-8222-222222222222', quantity: 2 }],
};
describe('canonical MCP transport', () => {
  it.each([
    'https://evil.example/api/storefront/cart/legacy',
    'http://ogabassey.com/api/storefront/cart/legacy',
    'https://ogabassey.com/other',
    'https://ogabassey.com/api/storefront/cart/legacy?token=x',
  ])('rejects an unapproved endpoint %s', (url) => {
    expect(() => createGuestCanonicalBridge(url, vi.fn())).toThrow();
  });
  it('accepts an allowlisted staging origin and rejects non-allowlisted ones', () => {
    const staging = 'https://staging.example.com/api/storefront/cart/legacy';
    expect(
      createGuestCanonicalBridge(staging, vi.fn(), [
        'https://staging.example.com',
      ])
    ).not.toBeNull();
    expect(() => createGuestCanonicalBridge(staging, vi.fn())).toThrow();
    expect(() =>
      createGuestCanonicalBridge(endpoint, vi.fn(), [
        'https://staging.example.com',
      ])
    ).toThrow();
  });

  it('stays disabled without explicit endpoint configuration', () => {
    expect(createGuestCanonicalBridge('', vi.fn())).toBeNull();
  });
  it('sends only the opaque capability header and honors canonical preconditions', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          state,
          continueUrl: 'https://ogabassey.com/cart#handoff=secret',
        })
      )
    );
    const bridge = createGuestCanonicalBridge(endpoint, fetcher);
    const result = await bridge?.update(token, {
      product_id: state.lines[0].productId,
      quantity: 2,
      expectedVersion: 3,
      operationId: 'op-1',
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL(endpoint),
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({
          Authorization: `Bearer legacy_mcp_${token}`,
        }),
        body: JSON.stringify({
          productId: state.lines[0].productId,
          quantity: 2,
          expectedVersion: 3,
          operationId: 'op-1',
          handoff: true,
        }),
      })
    );
    expect(result).toMatchObject({
      cart_token: token,
      canonical_cart_id: state.cartId,
      version: 4,
      cart_url: 'https://ogabassey.com/cart#handoff=secret',
    });
    expect(JSON.stringify(result)).not.toContain('proof');
  });
  it('probes liveness with a read-only probe request', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ exists: true }), { status: 200 })
      );
    const bridge = createGuestCanonicalBridge(endpoint, fetcher);
    await expect(bridge?.hasToken(token)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      new URL(endpoint),
      expect.objectContaining({
        body: JSON.stringify({ probe: true }),
        headers: expect.objectContaining({
          Authorization: `Bearer [REDACTED]${token}`,
        }),
      })
    );
  });

  it('fails closed on stale-version replies without issuing legacy writes', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: 'version_conflict',
          state,
          continueUrl: null,
        }),
        { status: 409 }
      )
    );
    await expect(
      createGuestCanonicalBridge(endpoint, fetcher)?.update(token, {
        product_id: state.lines[0].productId,
        quantity: 2,
      })
    ).rejects.toMatchObject({
      code: 'version_conflict',
      cartId: state.cartId,
      cartToken: token,
      retryable: true,
    });
  });
});

it.each([
  'version_conflict',
  'refresh_required',
])('retains the same capability for typed retryable %s broker failures', async (code) => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ code, error: 'Cart changed' }), {
      status: 409,
    })
  );
  const bridge = createGuestCanonicalBridge(endpoint, fetcher);
  await expect(
    bridge?.update(token, { product_id: state.lines[0].productId, quantity: 2 })
  ).rejects.toMatchObject({ code, cartToken: token, retryable: true });
});
it('maps a bare forbidden broker body to a typed unauthorized result', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'forbidden', error: 'Not allowed' }),
        { status: 403 }
      )
    );
  await expect(
    createGuestCanonicalBridge(endpoint, fetcher)?.update(token, {
      product_id: state.lines[0].productId,
      quantity: 2,
    })
  ).rejects.toMatchObject({ code: 'unauthorized', retryable: false });
});
it('maps a bare expired broker body to the existing typed expiry outcome', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ code: 'expired', error: 'Expired' }), {
      status: 404,
    })
  );
  await expect(
    createGuestCanonicalBridge(endpoint, fetcher)?.update(token, {
      product_id: state.lines[0].productId,
      quantity: 2,
    })
  ).rejects.toMatchObject({ name: 'GuestCartExpiredError' });
});
it('reserves the migration outcome for an explicit migration code', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'cart_migrated', cart_id: state.cartId }),
        { status: 409 }
      )
    );
  await expect(
    createGuestCanonicalBridge(endpoint, fetcher)?.update(token, {
      product_id: state.lines[0].productId,
      quantity: 2,
    })
  ).rejects.toMatchObject({
    name: 'GuestCartMigratedError',
    cartId: state.cartId,
  });
});
it('handles a malformed outage body without throwing an SDK parse error', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response('Unavailable', { status: 503 }));
  await expect(
    createGuestCanonicalBridge(endpoint, fetcher)?.update(token, {
      product_id: state.lines[0].productId,
      quantity: 2,
    })
  ).rejects.toMatchObject({
    code: 'temporarily_unavailable',
    retryable: true,
    cartToken: token,
  });
});
it.each([
  ['merchant_unavailable', 403, false],
  ['quota_exceeded', 429, true],
  ['rate_limited', 429, true],
  ['merchant_unresolved', 404, false],
  ['cart_locked', 409, false],
  ['idempotency_conflict', 409, false],
])('preserves typed broker failure %s', async (code, status, retryable) => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ code, error: 'Safe public error' }), {
      status: status as number,
    })
  );
  await expect(
    createGuestCanonicalBridge(endpoint, fetcher)?.update(token, {
      product_id: state.lines[0].productId,
      quantity: 2,
    })
  ).rejects.toMatchObject({ code, retryable, cartToken: token });
});
it('normalizes network failure to retryable unavailability without provider details', async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValue(new TypeError('private transport detail'));
  await expect(
    createGuestCanonicalBridge(endpoint, fetcher)?.update(token, {
      product_id: state.lines[0].productId,
      quantity: 2,
    })
  ).rejects.toMatchObject({
    code: 'temporarily_unavailable',
    retryable: true,
    cartToken: token,
    message: 'Canonical cart request could not complete',
  });
});
