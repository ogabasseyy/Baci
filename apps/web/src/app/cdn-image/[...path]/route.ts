import { type NextRequest, NextResponse } from 'next/server';
import { fetchSameOriginOgabasseyImageResponse } from '@/lib/ogabassey-same-origin-cdn-image';
import { ogabasseyCdnImageProxyPathSchema } from '@/schemas/ogabassey-cdn-image-proxy';
import { ogabasseyCdnImageProxySearchParamsSchema } from '@/schemas/ogabassey-cdn-image-query';

interface CdnImageRouteContext {
  params: Promise<{
    path: string[];
  }>;
}

/**
 * Handles `GET /cdn-image/[...path]` requests by validating the transform
 * options, asset path prefix/extension, and optional `?v=` query parameter
 * before proxying the image from `cdn.ogabassey.com`.
 */
export async function GET(
  request: NextRequest,
  context: CdnImageRouteContext
): Promise<Response> {
  const { path } = await context.params;
  const parsed = ogabasseyCdnImageProxyPathSchema.safeParse(path);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid CDN image request' },
      { status: 400 }
    );
  }

  const rawSearchEntries = Array.from(request.nextUrl.searchParams.entries());
  const hasDuplicateKeys =
    new Set(rawSearchEntries.map(([key]) => key)).size !==
    rawSearchEntries.length;
  const parsedQuery = ogabasseyCdnImageProxySearchParamsSchema.safeParse(
    Object.fromEntries(rawSearchEntries)
  );

  if (hasDuplicateKeys || !parsedQuery.success) {
    return NextResponse.json(
      { error: 'Invalid CDN image query parameters' },
      { status: 400 }
    );
  }

  const safeSearchParams = new URLSearchParams();
  if (parsedQuery.data.v) {
    safeSearchParams.set('v', parsedQuery.data.v);
  }

  return fetchSameOriginOgabasseyImageResponse(
    parsed.data,
    fetch,
    safeSearchParams
  );
}
