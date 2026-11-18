import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-auth';
import { cache, generateCacheKey } from '@/lib/cache';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { deleteCachedInsights } from '../insights/insights-cache';

/**
 * DELETE /api/analytics/cache
 * Invalidate analytics cache for the current merchant
 * Useful after creating orders, updating products, etc.
 */
export async function DELETE() {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get merchant context (supports both owners and staff members)
    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'analytics', 'view')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const merchantId = merchantContext.merchantId;

    // Delete all cache entries for this merchant (using wildcards)
    cache.deletePattern(`analytics:${merchantId}*`);
    cache.deletePattern(`ai-insights:${merchantId}*`);
    const redisInvalidated = await deleteCachedInsights(
      generateCacheKey('ai-insights', merchantId)
    );

    return NextResponse.json({
      message: 'Cache invalidated successfully',
      merchantId: merchantId,
      redisInvalidated,
    });
  } catch (error) {
    console.error('Error invalidating cache:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/analytics/cache
 * Get cache stats (for debugging)
 */
export function GET() {
  try {
    return NextResponse.json({
      size: cache.size(),
      message:
        'Cache is running with in-memory storage. For production, consider Redis.',
    });
  } catch (error) {
    console.error('Error getting cache stats:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
