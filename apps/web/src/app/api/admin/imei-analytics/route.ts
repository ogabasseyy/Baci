import { NextResponse } from 'next/server';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { createClient } from '@/lib/supabase/server';
import {
  imeiAnalyticsQuerySchema,
  imeiAnalyticsSchema,
} from '@/schemas/imei-check-analytics';

export async function GET(request: Request) {
  const auth = await getPlatformAdminAuthForPermission('analytics.read');
  if (auth.status !== 'authenticated')
    return NextResponse.json(
      { error: 'Analytics access required' },
      { status: auth.status === 'unauthenticated' ? 401 : 403 }
    );
  const params = new URL(request.url).searchParams;
  const query = imeiAnalyticsQuerySchema.safeParse({
    period: params.get('period') ?? undefined,
    merchantSlug: params.get('merchantSlug') ?? undefined,
  });
  if (!query.success)
    return NextResponse.json(
      { error: 'Invalid analytics filters' },
      { status: 400 }
    );
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      'get_admin_imei_check_analytics',
      {
        p_period: query.data.period,
        p_merchant_slug: query.data.merchantSlug ?? null,
      }
    );
    if (error)
      return NextResponse.json(
        { error: 'IMEI analytics are unavailable' },
        { status: error.code === '42501' ? 403 : 500 }
      );
    const result = imeiAnalyticsSchema.safeParse(data);
    if (!result.success)
      return NextResponse.json(
        { error: 'IMEI analytics are unavailable' },
        { status: 502 }
      );
    return NextResponse.json(result.data, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return NextResponse.json(
      { error: 'IMEI analytics are unavailable' },
      { status: 500 }
    );
  }
}
