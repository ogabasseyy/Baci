import { describe, expect, it } from 'vitest';
import {
  cartErrorResponse,
  cartJsonResponse,
  setCartSessionCookie,
} from './response';

describe('cartJsonResponse', () => {
  it('returns private, non-stored JSON without caching', async () => {
    const response = cartJsonResponse({ cart: { version: 2 } });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ cart: { version: 2 } });
  });

  it('supports creation responses without leaking cacheable state', async () => {
    const response = cartJsonResponse({ created: true }, { status: 201 });

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});

describe('cartErrorResponse', () => {
  it('maps malformed input to a typed 400', async () => {
    const response = cartErrorResponse('invalid_request');

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json();
    expect(body.code).toBe('invalid_request');
    expect(typeof body.error).toBe('string');
  });

  it('maps proof failures to 401 without distinguishing details', async () => {
    for (const code of [
      'missing_proof',
      'invalid_proof',
      'expired_proof',
    ] as const) {
      const response = cartErrorResponse(code);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.code).toBe(code);
    }
  });

  it('maps merchant mismatch and unavailable stores to 403', async () => {
    expect(cartErrorResponse('merchant_mismatch').status).toBe(403);
    expect(cartErrorResponse('merchant_unavailable').status).toBe(403);
  });

  it('maps unknown merchants and missing carts to 404', async () => {
    expect(cartErrorResponse('merchant_unresolved').status).toBe(404);
    expect(cartErrorResponse('not_found').status).toBe(404);
    const expired = cartErrorResponse('expired');
    expect(expired.status).toBe(404);
    expect((await expired.json()).code).toBe('expired');
  });

  it('maps version and idempotency conflicts to 409', async () => {
    expect(cartErrorResponse('version_conflict').status).toBe(409);
    expect(cartErrorResponse('idempotency_conflict').status).toBe(409);
    expect(cartErrorResponse('merge_conflict').status).toBe(409);
  });

  it('maps consumed handoff links to 404 without a retryable signal', async () => {
    const response = cartErrorResponse('handoff_consumed');

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('handoff_consumed');
  });

  it('maps quotas to 429 and outages to 503, never to 404', async () => {
    expect(cartErrorResponse('quota_exceeded').status).toBe(429);
    expect(cartErrorResponse('rate_limited').status).toBe(429);
    const outage = cartErrorResponse('temporarily_unavailable');
    expect(outage.status).toBe(503);
    expect((await outage.json()).code).toBe('temporarily_unavailable');
  });

  it('carries reconciliation state when a failure includes a cart', async () => {
    const response = cartErrorResponse('version_conflict', {
      cart: { version: 4 },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      cart: { version: 4 },
      code: 'version_conflict',
      error: expect.any(String),
    });
  });
});

describe('setCartSessionCookie', () => {
  it('sets a host-only HttpOnly session cookie namespaced by merchant', () => {
    const response = cartJsonResponse({ ok: true });
    setCartSessionCookie(response, 'ogabassey', 'cp1.proof.signature', 900);

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('baci-cart-ogabassey=cp1.proof.signature');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('SameSite=lax');
    expect(setCookie).toContain('Max-Age=900');
    expect(setCookie).not.toContain('Domain=');
  });

  it('namespaces cookies per merchant so one origin keeps stores separate', () => {
    const first = cartJsonResponse({ ok: true });
    const second = cartJsonResponse({ ok: true });
    setCartSessionCookie(first, 'store-a', 'proof-a', 900);
    setCartSessionCookie(second, 'store-b', 'proof-b', 900);

    expect(first.headers.get('set-cookie')).toContain('baci-cart-store-a=');
    expect(first.headers.get('set-cookie')).not.toContain('proof-b');
    expect(second.headers.get('set-cookie')).toContain('baci-cart-store-b=');
  });
});
