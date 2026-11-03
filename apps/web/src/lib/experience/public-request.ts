import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { checkCartQuota } from '@/lib/cart/request-quota';
import { getTrustedClientIdentifier } from '@/lib/rate-limit';
import { experiencePublicRequestSchema } from '@/schemas/experience-public-request';
import { normalizeExperiencePath } from './route-ownership';
export function parseExperiencePublicRequest(value: unknown) {
  const parsed = experiencePublicRequestSchema.parse(value);
  return { ...parsed, path: normalizeExperiencePath(parsed.path) };
}
/** A separate subject namespace; this never provisions a cart or principal. */
export async function admitPublicExperienceRead(
  merchantId: string,
  request: NextRequest
) {
  const subject = createHash('sha256')
    .update(`experience:${getTrustedClientIdentifier(request)}`)
    .digest('hex');
  return (await checkCartQuota({ operation: 'snapshot', merchantId, subject }))
    .allowed;
}
