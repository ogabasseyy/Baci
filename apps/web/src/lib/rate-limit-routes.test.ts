import { describe, expect, it } from 'vitest';
import { getRateLimitConfig } from './rate-limit-routes';

describe('rate-limit route matching', () => {
  it('isolates submission writes from autocomplete and search reads', () => {
    expect(getRateLimitConfig('/api/search/submissions')).toMatchObject({
      pattern: '/api/search/submissions',
      config: { maxRequests: 20, windowMs: 60_000 },
    });
    expect(getRateLimitConfig('/api/search/autocomplete').pattern).toBe(
      'default'
    );
  });
  it('uses the polling bucket only for an exact quiz result route', () => {
    expect(
      getRateLimitConfig('/api/quiz/attempts/attempt-1/result')
    ).toMatchObject({
      pattern: '/api/quiz/attempts/:attemptId/result',
      config: { maxRequests: 120, windowMs: 60_000 },
    });
    expect(
      getRateLimitConfig('/api/quiz/attempts/attempt-1/result/details').config
        .maxRequests
    ).toBe(50);
  });

  it('keeps quiz writes and active-attempt recovery on the default bucket', () => {
    expect(
      getRateLimitConfig('/api/quiz/attempts/attempt-1/answers').config
        .maxRequests
    ).toBe(50);
    expect(
      getRateLimitConfig('/api/quiz/attempts/active').config.maxRequests
    ).toBe(50);
  });

  it('uses the most specific static prefix when no dynamic route matches', () => {
    expect(
      getRateLimitConfig('/api/storefront/auth/verify-code').config.maxRequests
    ).toBe(5);
    expect(
      getRateLimitConfig('/api/storefront/products').config.maxRequests
    ).toBe(100);
  });

  it('caps the expensive search-assist AI call below the default bucket', () => {
    expect(getRateLimitConfig('/api/search/assist')).toMatchObject({
      pattern: '/api/search/assist',
      config: { maxRequests: 5, windowMs: 60_000 },
    });
  });

  it('bounds product-request intake per IP below the merchant DB budget', () => {
    expect(
      getRateLimitConfig('/api/storefront/product-requests')
    ).toMatchObject({
      pattern: '/api/storefront/product-requests',
      config: { maxRequests: 10, windowMs: 3_600_000 },
    });
  });

  it('bounds anonymous cart bootstraps below the storefront bucket', () => {
    expect(getRateLimitConfig('/api/storefront/cart/bootstrap')).toMatchObject({
      pattern: '/api/storefront/cart/bootstrap',
      config: { maxRequests: 20, windowMs: 60_000 },
    });
    expect(getRateLimitConfig('/api/storefront/cart').config.maxRequests).toBe(
      100
    );
    expect(
      getRateLimitConfig('/api/storefront/cart/commands').config.maxRequests
    ).toBe(100);
  });

  it('bounds handoff issue, redeem and preview below the storefront bucket', () => {
    for (const path of [
      '/api/storefront/cart/handoff',
      '/api/storefront/cart/handoff/redeem',
    ]) {
      expect(getRateLimitConfig(path)).toMatchObject({
        config: { maxRequests: 20, windowMs: 60_000 },
        pattern: '/api/storefront/cart/handoff',
      });
    }
  });

  it('gives Chatwoot delivery estimates a tighter public IP budget', () => {
    expect(
      getRateLimitConfig('/api/storefront/chatwoot/context/delivery-options')
    ).toMatchObject({
      pattern: '/api/storefront/chatwoot/context/delivery-options',
      config: { maxRequests: 30, windowMs: 60_000 },
    });
  });

  it('bounds unauthenticated legacy bridge traffic per token bucket', () => {
    expect(getRateLimitConfig('/api/storefront/cart/legacy')).toMatchObject({
      pattern: '/api/storefront/cart/legacy',
      config: { maxRequests: 600, windowMs: 60_000 },
    });
  });

  it('gives GIG status webhooks their own per-IP bucket', () => {
    expect(getRateLimitConfig('/api/webhooks/gigl')).toMatchObject({
      pattern: '/api/webhooks/gigl',
      config: { maxRequests: 60, windowMs: 60_000 },
    });
    expect(getRateLimitConfig('/api/webhooks/mycover').pattern).toBe('default');
  });

  it('isolates autocomplete and place details in the Places bucket', () => {
    expect(getRateLimitConfig('/api/places').config.maxRequests).toBe(60);
    expect(getRateLimitConfig('/api/places/autocomplete')).toMatchObject({
      pattern: '/api/places',
      config: { maxRequests: 60, windowMs: 60_000 },
    });
    expect(getRateLimitConfig('/api/places/details')).toMatchObject({
      pattern: '/api/places/details',
      config: { maxRequests: 60, windowMs: 60_000 },
    });
    expect(getRateLimitConfig('/api/places-other').config.maxRequests).toBe(50);
  });

  it('puts the wallet PIN routes in their own fail-closed bucket', () => {
    for (const leaf of ['set', 'change', 'reset'])
      expect(
        getRateLimitConfig(`/api/storefront/customer/wallet-pin/${leaf}`)
      ).toMatchObject({
        pattern: '/api/storefront/customer/wallet-pin',
        config: {
          maxRequests: 10,
          windowMs: 60_000,
          failClosedWithoutRedis: true,
        },
      });
    // Status polling must not spend the hashing budget of the mutations.
    expect(
      getRateLimitConfig('/api/storefront/customer/wallet-pin/status')
    ).toMatchObject({
      pattern: '/api/storefront/customer/wallet-pin/status',
      config: { maxRequests: 60, failClosedWithoutRedis: true },
    });
    expect(
      getRateLimitConfig('/api/storefront/customer/wallet').pattern
    ).not.toBe('/api/storefront/customer/wallet-pin');
  });
});

it('keeps anonymous experience reads in their own public bucket', () => {
  expect(
    getRateLimitConfig('/api/storefront/experience/catalog')
  ).toMatchObject({
    pattern: '/api/storefront/experience',
    config: { maxRequests: 240, windowMs: 60000 },
  });
});
