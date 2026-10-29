import { type NextRequest, NextResponse } from 'next/server';
import { fetchSameOriginOgabasseyImageResponse } from '@/lib/ogabassey-same-origin-cdn-image';
import { ogabasseyCdnImageProxyPathSchema } from '@/schemas/ogabassey-cdn-image-proxy';

interface CdnImageRouteContext {
  params: Promise<{
    path: string[];
  }>;
}

export async function GET(
  _request: NextRequest,
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

  return fetchSameOriginOgabasseyImageResponse(parsed.data);
}
