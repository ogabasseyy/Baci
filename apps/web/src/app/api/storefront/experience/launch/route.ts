import type { NextRequest } from 'next/server';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import {
  admitPublicExperienceRead,
  parseExperiencePublicRequest,
} from '@/lib/experience/public-request';
import { resolvePublishedExperienceRequest } from '@/lib/experience/published-request-context';
import { getExperienceStorefrontRuntime } from '@/lib/experience/storefront-runtime';
import { experienceLaunchRenewalSchema } from '@/schemas/experience-public-request';

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'same-origin',
};
export async function POST(request: NextRequest) {
  const body = await readBoundedJsonBody(request, 4096);
  let input: ReturnType<typeof parseExperiencePublicRequest>;
  try {
    if (!body.ok) throw Error('INVALID_REQUEST');
    input = parseExperiencePublicRequest(body.body);
  } catch {
    return Response.json(
      { error: 'Invalid launch request.' },
      { status: 400, headers }
    );
  }
  try {
    const runtime = getExperienceStorefrontRuntime();
    if (!runtime)
      return Response.json(
        { error: 'Experience unavailable.' },
        { status: 503, headers }
      );
    const ctx = await resolvePublishedExperienceRequest(request);
    if (!ctx.ok)
      return Response.json(
        { error: 'Store unavailable.' },
        { status: 403, headers }
      );
    if (!(await admitPublicExperienceRead(ctx.merchant.id, request)))
      return Response.json(
        { error: 'Try again later.' },
        { status: 429, headers }
      );
    const data = await runtime.resolveBoundary(ctx.merchant, input.path);
    if (!data || data.manifest.buildDigest !== input.buildDigest)
      return Response.json(
        { error: 'Experience changed.' },
        { status: 409, headers }
      );
    return Response.json(
      experienceLaunchRenewalSchema.parse({
        buildDigest: data.manifest.buildDigest,
        policyRevision: data.manifest.policyRevision,
        catalogRevision: data.bootstrap.catalog.revision,
        expiresAt: data.launch.expiresAt,
      }),
      { headers }
    );
  } catch {
    return Response.json(
      { error: 'Experience unavailable.' },
      { status: 503, headers }
    );
  }
}
