import type { NextRequest } from 'next/server';
import { admitPublicExperienceRead } from '@/lib/experience/public-request';
import { parsePublishedExperience } from '@/lib/experience/published-manifest';
import { resolvePublishedExperienceRequest } from '@/lib/experience/published-request-context';
import { getExperienceStorefrontRuntime } from '@/lib/experience/storefront-runtime';
import { publicExperienceCatalogSchema } from '@/schemas/experience-catalog';
import { experienceCatalogSelection } from '@/schemas/experience-catalog-selection';

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'same-origin',
};
export async function GET(request: NextRequest) {
  const input = experienceCatalogSelection.safeParse(
    Object.fromEntries(
      [...request.nextUrl.searchParams].filter(([k]) => k !== 'merchantSlug')
    )
  );
  if (!input.success)
    return Response.json(
      { error: 'Invalid selection.' },
      { status: 400, headers }
    );
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
    const raw = await runtime.loadPublishedManifest(ctx.merchant);
    if (!raw)
      return Response.json(
        { error: 'Store unavailable.' },
        { status: 404, headers }
      );
    const head = parsePublishedExperience(raw);
    if (!head.capabilities.includes('catalog.read'))
      return Response.json(
        { error: 'Capability unavailable.' },
        { status: 403, headers }
      );
    const value = await runtime.catalog(ctx.merchant, input.data);
    const after = await runtime.loadPublishedManifest(ctx.merchant);
    if (
      !value ||
      !after ||
      parsePublishedExperience(after).policyRevision !== head.policyRevision
    )
      return Response.json(
        { error: 'Catalog changed.' },
        { status: 409, headers }
      );
    return Response.json(publicExperienceCatalogSchema.parse(value), {
      headers,
    });
  } catch {
    return Response.json(
      { error: 'Catalog unavailable.' },
      { status: 503, headers }
    );
  }
}
