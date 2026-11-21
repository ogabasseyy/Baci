import type { NextRequest } from 'next/server';
import { BRILSTASH_FEED_PATH } from '@/config/brilstash-feed';
import { checkTrustedDistributedRateLimit } from '../rate-limit';

export function checkBrilStashFeedRateLimit(
  request: NextRequest,
  bucket: 'read' | 'malformed'
) {
  return checkTrustedDistributedRateLimit(
    request,
    `${BRILSTASH_FEED_PATH}:${bucket}`,
    { maxRequests: bucket === 'read' ? 30 : 15, windowMs: 60_000 }
  );
}
