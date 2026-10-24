import type { NextResponse } from 'next/server';
import type { RateLimitResult } from '@/lib/rate-limit';

/** Advertise the quota actually enforced, without publishing its IP partition. */
export function applyApiRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult,
  windowMs: number,
  now = Date.now()
): void {
  const resetSeconds = Math.max(0, Math.ceil((result.resetTime - now) / 1000));
  const remaining = Math.max(0, Math.min(result.limit, result.remaining));
  response.headers.set('RateLimit', `"api";r=${remaining};t=${resetSeconds}`);
  response.headers.set(
    'RateLimit-Policy',
    `"api";q=${result.limit};w=${Math.ceil(windowMs / 1000)}`
  );
  // Per-caller quota must never be replayed by browser or shared caches.
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('CDN-Cache-Control', 'no-store');
  response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
  if (response.status === 429) {
    response.headers.set('Retry-After', String(resetSeconds));
  }
}
