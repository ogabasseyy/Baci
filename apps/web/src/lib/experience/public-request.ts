import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { experiencePublicRequestSchema } from '@/schemas/experience-public-request';
import { normalizeExperiencePath } from './route-ownership';
export function parseExperiencePublicRequest(value: unknown) {
  const parsed = experiencePublicRequestSchema.parse(value);
  return { ...parsed, path: normalizeExperiencePath(parsed.path) };
}
/** Standard anonymous admission; this never imports cart credentials or provisions a principal. */
export async function admitPublicExperienceRead(
  _merchantId: string,
  request: NextRequest
) {
  return (await checkRateLimit(request, '/api/storefront/experience')).allowed;
}
