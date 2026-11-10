import type { NextRequest } from 'next/server';
import {
  admitPublicExperienceRead,
  parseExperiencePublicRequest,
} from '@/lib/experience/public-request';
import { resolvePublishedExperienceRequest } from '@/lib/experience/published-request-context';
import { getExperienceStorefrontRuntime } from '@/lib/experience/storefront-runtime';

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
};
export async function GET(request: NextRequest) {
  let input: ReturnType<typeof parseExperiencePublicRequest>;
  try {
    input = parseExperiencePublicRequest({
      buildDigest: request.nextUrl.searchParams.get('buildDigest'),
      path: request.nextUrl.searchParams.get('path') ?? '/',
    });
  } catch {
    return Response.json({ active: false }, { status: 400, headers });
  }
  try {
    const runtime = getExperienceStorefrontRuntime();
    if (!runtime)
      return Response.json({ active: false }, { status: 503, headers });
    const context = await resolvePublishedExperienceRequest(request);
    if (!context.ok)
      return Response.json({ active: false }, { status: 403, headers });
    if (!(await admitPublicExperienceRead(context.merchant.id, request)))
      return Response.json({ active: false }, { status: 429, headers });
    return Response.json(
      await runtime.state(context.merchant, input.buildDigest, input.path),
      { headers }
    );
  } catch {
    return Response.json({ active: false }, { status: 503, headers });
  }
}
