import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { parseRequestedMerchantId } from '@/app/api/branches/branch-route-utils';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { analyticsDashboardSpecializedSchemas } from '@/schemas/analytics-dashboard-specialized';

/**
 * Inventory Alerts API
 *
 * GET - List all active alerts
 * PATCH - Acknowledge/resolve alerts
 *
 * Query params (GET):
 * - status: 'active' | 'acknowledged' | 'resolved' (default: 'active')
 * - type: 'low_stock' | 'out_of_stock' | 'predicted_stockout' | 'reorder_point'
 */

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsedQuery =
      analyticsDashboardSpecializedSchemas.inventoryAlertsQuery.safeParse({
        status: searchParams.get('status') ?? undefined,
        type: searchParams.get('type') ?? undefined,
      });
    if (!parsedQuery.success) {
      return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
    }

    const requestedMerchant = parseRequestedMerchantId(request);
    if (requestedMerchant.response) {
      return requestedMerchant.response;
    }

    const merchantContext = await getMerchantForApiRequest(supabase, user.id, {
      requestedMerchantId: requestedMerchant.merchantId,
    });
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const merchantId = merchantContext.merchantId;
    if (!hasPermission(toUserAccess(merchantContext), 'products', 'view')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { status, type: alertType } = parsedQuery.data;

    let query = supabase
      .from('inventory_alerts')
      .select(
        `
        id,
        alert_type,
        current_stock,
        status,
        product_id,
        variant_id,
        created_at,
        products (
          id,
          name,
          image,
          stock,
          low_stock_threshold
        )
      `,
        { count: 'exact' }
      )
      .eq('merchant_id', merchantId)
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (alertType) {
      query = query.eq('alert_type', alertType);
    }

    const { data: alerts, error, count } = await query;

    if (error) {
      console.error('Error fetching alerts:', error);
      return NextResponse.json(
        { error: 'Failed to fetch alerts' },
        { status: 500 }
      );
    }

    // Count by type
    const { data: typeCounts } = await supabase
      .from('inventory_alerts')
      .select('alert_type')
      .eq('merchant_id', merchantId)
      .eq('status', 'active');

    const alertsByType: Record<string, number> = {};
    (typeCounts || []).forEach((item) => {
      alertsByType[item.alert_type] = (alertsByType[item.alert_type] || 0) + 1;
    });

    return NextResponse.json({
      alerts,
      stats: {
        // `alerts` can be capped by PostgREST's response row limit. Keep the
        // metric exact so consumers do not mistake a truncated page for the
        // merchant's total alert count.
        total: count ?? alerts?.length ?? 0,
        byType: alertsByType,
      },
    });
  } catch (error) {
    console.error('Alerts GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    const parsedBody =
      analyticsDashboardSpecializedSchemas.inventoryAlertsAction.safeParse(
        body
      );
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const requestedMerchant = parseRequestedMerchantId(request);
    if (requestedMerchant.response) {
      return requestedMerchant.response;
    }

    const merchantContext = await getMerchantForApiRequest(supabase, user.id, {
      requestedMerchantId: requestedMerchant.merchantId,
    });
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const merchantId = merchantContext.merchantId;
    if (!hasPermission(toUserAccess(merchantContext), 'products', 'edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { action, alertIds } = parsedBody.data;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (action === 'acknowledge') {
      updates.status = 'acknowledged';
      updates.acknowledged_at = new Date().toISOString();
      updates.acknowledged_by = user.id;
    } else if (action === 'resolve') {
      updates.status = 'resolved';
      updates.resolved_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('inventory_alerts')
      .update(updates)
      .in('id', alertIds)
      .eq('merchant_id', merchantId);

    if (error) {
      console.error('Error updating alerts:', error);
      return NextResponse.json(
        { error: 'Failed to update alerts' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      updated: alertIds.length,
    });
  } catch (error) {
    console.error('Alerts PATCH error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
