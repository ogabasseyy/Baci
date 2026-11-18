import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  getStorefrontFeatures,
  type StorefrontFeatures,
} from '@/lib/storefront/get-storefront-features';
import { storefrontFeaturesQuerySchema } from '@/schemas/storefront-features';

export type { StorefrontFeatures };

/**
 * Storefront Feature Settings API (Public)
 *
 * GET - Get public feature settings for a store
 *
 * Query params:
 * - merchantId: string (required) - The merchant's ID
 * - slug: string (alternative) - The merchant's slug
 */
export async function GET(request: NextRequest) {
  try {
    const parseResult = storefrontFeaturesQuerySchema.safeParse({
      merchantId: request.nextUrl.searchParams.get('merchantId') || undefined,
      slug: request.nextUrl.searchParams.get('slug') || undefined,
    });

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error:
            parseResult.error.issues[0]?.message ?? 'Invalid query parameters',
        },
        { status: 400 }
      );
    }

    const { merchantId, slug } = parseResult.data;
    const result = await getStorefrontFeatures({ merchantId, slug });

    if (result.status === 404) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    }

    if (result.degraded) {
      return NextResponse.json(result.features, {
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    return NextResponse.json(result.features, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, must-revalidate',
        'Vercel-Cache-Tag': `merchant-features-${result.merchantId}`,
      },
    });
  } catch (error) {
    logger.error({
      message: 'Storefront features GET error',
      error: error instanceof Error ? error : new Error('Unknown error'),
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}
