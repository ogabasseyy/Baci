import { type NextRequest, NextResponse } from 'next/server';
import { getAllCategories } from '@/lib/jumia/catalog';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { authorizeJumiaMetadata } from '@/lib/jumia/metadata-request';
import { logger } from '@/lib/logger';
import { JumiaCategorySchema } from '@/schemas/jumia/catalog';

export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeJumiaMetadata(request, false);
    if ('response' in auth) return auth.response;
    const categories = JumiaCategorySchema.array().parse(
      await getAllCategories(auth.client)
    );
    return NextResponse.json({ categories, configured: true });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('prerendering') ||
        error.message.includes('dynamic server usage'))
    )
      throw error;
    if (error instanceof JumiaApiError && error.status === 404) {
      if (!new URL(request.url).searchParams.has('integrationId'))
        return NextResponse.json({ categories: [], configured: false });
      return NextResponse.json(
        { error: 'Jumia integration unavailable' },
        { status: 404 }
      );
    }
    logger.error({
      message: 'Jumia categories metadata unavailable',
      status: 502,
      kind: error instanceof JumiaApiError ? 'provider' : 'metadata',
    });
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 502 }
    );
  }
}
