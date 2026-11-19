import { type NextRequest, NextResponse } from 'next/server';
import { resolveRepairsCatalogMerchant } from '@/lib/repairs/repairs-catalog-access';
import { getRepairDevicesForMerchant } from '@/lib/repairs/repairs-catalog-data';
import {
  repairsDevicesQuerySchema,
  repairsDevicesRouteParamsSchema,
} from '@/schemas/repair-catalog';

const CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const parsedParams = repairsDevicesRouteParamsSchema.safeParse(
      await params
    );
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          error: 'Invalid route parameters',
          details: parsedParams.error.flatten(),
        },
        { status: 400 }
      );
    }

    const parsedQuery = repairsDevicesQuerySchema.safeParse({
      q: request.nextUrl.searchParams.get('q') ?? undefined,
      mode: request.nextUrl.searchParams.get('mode') ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: parsedQuery.error.flatten(),
        },
        { status: 400 }
      );
    }

    const merchant = await resolveRepairsCatalogMerchant(
      parsedParams.data.slug
    );
    if (!merchant?.enabled) {
      return NextResponse.json(
        { error: 'Repairs catalogue not available' },
        { status: 404 }
      );
    }

    const groups = await getRepairDevicesForMerchant(
      merchant.merchantId,
      parsedQuery.data.q,
      parsedQuery.data.mode
    );

    return NextResponse.json(
      { groups },
      { headers: { 'Cache-Control': CACHE_CONTROL } }
    );
  } catch (error) {
    console.error(
      'Error in GET /api/storefront/[slug]/repairs/devices:',
      error
    );
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
