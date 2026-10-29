import { type NextRequest, NextResponse } from 'next/server';
import { fetchSameOriginOgabasseyImageResponse } from '@/lib/ogabassey-same-origin-cdn-image';
import {
  ogabasseyCdnImageProxyPathSchema,
  ogabasseyCdnImageProxySearchParamsSchema,
} from '@/schemas/ogabassey-cdn-image-proxy';

interface CdnImageRouteContext {
  params: Promise<{
    path: string[];
  }>;
}

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
