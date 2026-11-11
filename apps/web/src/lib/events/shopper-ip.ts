import type { NextRequest } from 'next/server';
import { getClientIdentifier } from '@/lib/rate-limit-client';

/**
 * The real shopper address for ad-platform matching. Behind Cloudflare the
 * raw x-forwarded-for entry is Cloudflare's own address, which ad platforms
 * cannot match to a person; getClientIdentifier returns the verified visitor
 * address instead. Returns undefined when no valid address is known.
 */
export function shopperIp(request: NextRequest): string | undefined {
  const ip = getClientIdentifier(request);
  return ip === 'unknown' ? undefined : ip;
}
