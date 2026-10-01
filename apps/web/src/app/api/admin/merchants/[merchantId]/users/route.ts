import { type NextRequest, NextResponse } from 'next/server';
import { getAdminMerchant360 } from '@/lib/admin-merchant-360';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { createClient } from '@/lib/supabase/server';
import { adminMerchantRouteParamsSchema } from '@/schemas/admin-merchant-route-params';

type RouteContext = {
  params: Promise<{ merchantId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await getPlatformAdminAuthForPermission('merchants.read');
  if (auth.status !== 'authenticated') {
    return NextResponse.json(
      {
        error: auth.status === 'unauthenticated' ? 'Unauthorized' : 'Forbidden',
      },
      { status: auth.status === 'unauthenticated' ? 401 : 403 }
    );
  }

  const parseResult = adminMerchantRouteParamsSchema.safeParse(
    await context.params
  );
  if (!parseResult.success) {
    return NextResponse.json(
      {
        code: 'INVALID_MERCHANT_ID',
        error: parseResult.error.issues[0]?.message ?? 'Invalid merchant ID',
      },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await getAdminMerchant360(
    supabase,
    parseResult.data.merchantId
  );

  if (error) {
    console.error('[Admin merchant 360] Query failed:', { code: error.code });
    return NextResponse.json(
      { error: 'Failed to fetch merchant operations' },
      { status: error.code === '42501' ? 403 : 500 }
    );
  }

  if (!data) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }

  console.info('[Admin merchant 360] Snapshot read:', {
    customerCount: data.summary.customerUsers,
    generatedAt: data.generatedAt,
    staffCount: data.summary.staffUsers,
  });

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
