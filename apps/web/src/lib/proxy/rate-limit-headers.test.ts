import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { applyApiRateLimitHeaders } from './rate-limit-headers';

describe('API quota response metadata', () => {
  it('uses delta seconds, rounds up, and replaces stale cache metadata', () => {
    const response = NextResponse.next({
      headers: {
        'Cache-Control': 'public, max-age=600',
        'CDN-Cache-Control': 'max-age=600',
        'Vercel-CDN-Cache-Control': 'max-age=600',
      },
    });
    applyApiRateLimitHeaders(
      response,
      {
        allowed: true,
        limit: 30,
        remaining: 29,
        resetTime: 61_001,
      },
      60_000,
      1_000
    );
    expect(response.headers.get('RateLimit')).toBe('"api";r=29;t=61');
    expect(response.headers.get('RateLimit-Policy')).toBe('"api";q=30;w=60');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('CDN-Cache-Control')).toBe('no-store');
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBeNull();
  });

  it('clamps exhausted and expired quotas and aligns retry guidance', () => {
    const response = NextResponse.json({}, { status: 429 });
    applyApiRateLimitHeaders(
      response,
      {
        allowed: false,
        limit: 30,
        remaining: -1,
        resetTime: 999,
      },
      60_000,
      1_000
    );
    expect(response.headers.get('RateLimit')).toBe('"api";r=0;t=0');
    expect(response.headers.get('Retry-After')).toBe('0');
  });
});
