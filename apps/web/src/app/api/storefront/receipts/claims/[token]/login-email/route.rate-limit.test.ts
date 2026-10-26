import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () =>
    Promise.resolve({
      allowed: false,
      limit: 100,
      remaining: 0,
      resetTime: 60,
    }),
  createRateLimitResponse: () =>
    new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
    }),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: () => Promise.resolve({ response: null, valid: true }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    throw new Error('must not construct a client when rate limited');
  },
}));

import { GET } from './route';

const params = { params: Promise.resolve({ token: 'claim-token' }) };

describe('GET login-email rate limit', () => {
  it('returns 429 without touching Supabase when the bucket is exhausted', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/storefront/receipts/claims/claim-token/login-email'
      ),
      params
    );

    expect(response.status).toBe(429);
  });
});
