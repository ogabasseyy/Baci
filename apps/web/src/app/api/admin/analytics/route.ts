import { type NextRequest, NextResponse } from 'next/server';
import { getAdminPlatformAnalytics } from '@/lib/admin-platform-analytics';
import { revalidateAnalytics } from '@/lib/cache-revalidation';
import { checkCsrfProtection } from '@/lib/csrf';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { createClient } from '@/lib/supabase/server';
import { adminAnalyticsQuerySchema } from '@/schemas/admin-analytics-query';

function platformAuthError(status: 'forbidden' | 'unauthenticated') {
  return NextResponse.json(
    { error: status === 'unauthenticated' ? 'Unauthorized' : 'Forbidden' },
    { status: status === 'unauthenticated' ? 401 : 403 }
  );
}

/** Returns complete live platform aggregates for the selected period. */
export async function GET(request: NextRequest) {
  const auth = await getPlatformAdminAuthForPermission('analytics.read');
  if (auth.status !== 'authenticated') {
    return platformAuthError(auth.status);
  }

  try {
    const { searchParams } = new URL(request.url);
    const parseResult = adminAnalyticsQuerySchema.safeParse({
      period: searchParams.get('period') ?? undefined,
    });
    if (!parseResult.success) {
      return NextResponse.json(
        {
          code: 'INVALID_PERIOD',
          error:
            parseResult.error.issues[0]?.message ?? 'Invalid period parameter',
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data, error } = await getAdminPlatformAnalytics(
      supabase,
      parseResult.data.period
    );
    if (error || !data) {
      console.error('Admin analytics aggregate error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch analytics data' },
        { status: error?.code === '42501' ? 403 : 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Platform analytics error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch platform analytics' },
      { status: 500 }
    );
  }
}

/** Confirms authorization and invalidates any framework-level analytics cache. */
export async function POST(request: NextRequest) {
  const auth = await getPlatformAdminAuthForPermission('analytics.read');
  if (auth.status !== 'authenticated') {
    return platformAuthError(auth.status);
  }

  try {
    const { valid, response } = await checkCsrfProtection(request);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    revalidateAnalytics();
    return NextResponse.json({
      message: 'Live platform analytics reloaded successfully',
      refreshedAt: new Date().toISOString(),
      success: true,
    });
  } catch (error) {
    console.error('Reload analytics error:', error);
    return NextResponse.json(
      { error: 'Failed to reload analytics' },
      { status: 500 }
    );
  }
}
