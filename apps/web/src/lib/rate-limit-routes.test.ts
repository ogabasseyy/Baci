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
});
