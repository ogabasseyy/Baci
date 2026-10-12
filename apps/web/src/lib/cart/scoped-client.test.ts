import { describe, expect, it } from 'vitest';
import type { CartPrincipal } from './principal';
import {
  CART_SCOPED_TOKEN_TTL_SECONDS,
  createCartReceiveClient,
  createCartScopedClient,
} from './scoped-client';

const PRINCIPAL: CartPrincipal = {
  allowedOperations: ['add', 'set_quantity', 'remove', 'clear'],
  cartId: '22222222-2222-4222-8222-222222222222',
  expiresAt: '2026-10-13T04:00:00Z',
  grantId: '33333333-3333-4333-8333-333333333333',
  merchantId: '11111111-1111-4111-8111-111111111111',
  principalId: 'guest-principal-001',
  scope: 'session',
};

const SIGNER = {
  secret: 'test-scoped-jwt-secret-with-enough-length-001',
  type: 'legacy-secret' as const,
};

function bearerPayload(client: {
  auth: { getSession: unknown };
  rest: { headers: Headers };
}): Record<string, unknown> {
  const header = client.rest.headers.get('Authorization');
  expect(header?.startsWith('Bearer ')).toBe(true);
  const token = (header as string).slice('Bearer '.length);
  const [, payload] = token.split('.');
  return JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8')
  ) as Record<string, unknown>;
}

describe('createCartScopedClient', () => {
  it('mints a short-lived shopper token bound to merchant, cart, grant and principal', () => {
    const now = new Date('2026-10-12T04:00:00Z');
    const client = createCartScopedClient(PRINCIPAL, {
      anonKey: 'test-anon-key',
      now,
      signer: SIGNER,
      supabaseUrl: 'https://test.supabase.co',
    });
    const payload = bearerPayload(
      client as unknown as Parameters<typeof bearerPayload>[0]
    );

    expect(payload.role).toBe('commerce_cart_shopper');
    expect(payload.cart_merchant_id).toBe(PRINCIPAL.merchantId);
    expect(payload.cart_id).toBe(PRINCIPAL.cartId);
    expect(payload.cart_grant_id).toBe(PRINCIPAL.grantId);
    expect(payload.cart_principal_id).toBe(PRINCIPAL.principalId);
    expect(payload.cart_scope).toBe('session');
    expect(payload.aud).toBe('authenticated');
    expect(typeof payload.exp).toBe('number');
    expect(typeof payload.iat).toBe('number');
    expect(
      (payload.exp as number) - (payload.iat as number)
    ).toBeLessThanOrEqual(CART_SCOPED_TOKEN_TTL_SECONDS);
  });

  it('never mints the broad authenticated role or service role', () => {
    const client = createCartScopedClient(PRINCIPAL, {
      anonKey: 'test-anon-key',
      now: new Date('2026-10-12T04:00:00Z'),
      signer: SIGNER,
      supabaseUrl: 'https://test.supabase.co',
    });
    const payload = bearerPayload(
      client as unknown as Parameters<typeof bearerPayload>[0]
    );

    expect(payload.role).not.toBe('authenticated');
    expect(payload.role).not.toBe('service_role');
  });

  it('mints bootstrap tokens without cart or grant claims', () => {
    const bootstrap: CartPrincipal = {
      ...PRINCIPAL,
      allowedOperations: [],
      cartId: null,
      grantId: null,
      scope: 'bootstrap',
    };
    const client = createCartScopedClient(bootstrap, {
      anonKey: 'test-anon-key',
      now: new Date('2026-10-12T04:00:00Z'),
      signer: SIGNER,
      supabaseUrl: 'https://test.supabase.co',
    });
    const payload = bearerPayload(
      client as unknown as Parameters<typeof bearerPayload>[0]
    );

    expect(payload.role).toBe('commerce_cart_shopper');
    expect(payload.cart_scope).toBe('bootstrap');
    expect(payload.cart_id ?? null).toBeNull();
    expect(payload.cart_grant_id ?? null).toBeNull();
  });
});

describe('createCartReceiveClient', () => {
  it('mints a receive-only token with no mutation role', () => {
    const client = createCartReceiveClient(PRINCIPAL, {
      anonKey: 'test-anon-key',
      now: new Date('2026-10-12T04:00:00Z'),
      signer: SIGNER,
      supabaseUrl: 'https://test.supabase.co',
    });
    const payload = bearerPayload(
      client as unknown as Parameters<typeof bearerPayload>[0]
    );

    expect(payload.role).toBe('commerce_cart_receiver');
    expect(payload.cart_merchant_id).toBe(PRINCIPAL.merchantId);
    expect(payload.cart_id).toBe(PRINCIPAL.cartId);
    expect(payload.cart_scope).toBe('session');
    expect(
      (payload.exp as number) - (payload.iat as number)
    ).toBeLessThanOrEqual(CART_SCOPED_TOKEN_TTL_SECONDS);
  });
});
