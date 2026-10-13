import { type NextRequest, NextResponse } from 'next/server';
import { getAdminMerchantHealthPage } from '@/lib/admin-merchant-health';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { createClient } from '@/lib/supabase/server';
import { adminMerchantsQuerySchema } from '@/schemas/admin-merchants-query';
import type { AdminMerchantsResponse } from '@/types/admin-merchants';

export async function GET(request: NextRequest) {
  const auth = await getPlatformAdminAuthForPermission('merchants.read');
  if (auth.status !== 'authenticated') {
    return NextResponse.json(
      {
        error: auth.status === 'unauthenticated' ? 'Unauthorized' : 'Forbidden',
      },
      { status: auth.status === 'unauthenticated' ? 401 : 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const parseResult = adminMerchantsQuerySchema.safeParse({
      health: searchParams.get('health') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      offset: searchParams.get('offset') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      sortBy: searchParams.get('sortBy') ?? undefined,
    });

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error:
            parseResult.error.issues[0]?.message ?? 'Invalid sort parameter',
          code: 'INVALID_MERCHANTS_QUERY',
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data, error, total } = await getAdminMerchantHealthPage(
      supabase,
      parseResult.data
    );

    if (error) {
      console.error('Admin merchants RPC error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch merchant data' },
        { status: error.code === '42501' ? 403 : 500 }
      );
    }

    const response: AdminMerchantsResponse = {
      data,
      generatedAt: new Date().toISOString(),
      pagination: {
        limit: parseResult.data.limit,
        offset: parseResult.data.offset,
        total,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Admin merchants route error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch merchant data' },
      { status: 500 }
    );
  }
}
