import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-auth';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { createClient } from '@/lib/supabase/server';
import { getJumiaOrderScope } from './get-jumia-order-scope';
import { parseJumiaOrderQuery } from './parse-jumia-order-query';

export async function getCachedJumiaOrders(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    if (!hasPermission(toUserAccess(merchantContext), 'integrations', 'view')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const merchantId = merchantContext.merchantId;
    const featureGateResponse = await requireMerchantFeatureAccess(
      supabase,
      merchantId,
      'marketplace_sync'
    );
    if (featureGateResponse) return featureGateResponse;

    const queryParsed = parseJumiaOrderQuery(new URL(request.url).searchParams);
    if (!queryParsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', code: 'invalid_query_parameters' },
        { status: 400 }
      );
    }
    const { limit, offset, status, integrationId } = queryParsed.data;
    let orderScope: Awaited<ReturnType<typeof getJumiaOrderScope>> | undefined;
    if (integrationId) {
      orderScope = await getJumiaOrderScope(
        supabase,
        merchantId,
        integrationId
      );
      if (orderScope.kind === 'database_error') {
        return NextResponse.json(
          { error: orderScope.message },
          { status: 500 }
        );
      }
      if (orderScope.kind === 'not_found') {
        return NextResponse.json(
          { error: 'Integration not found' },
          { status: 404 }
        );
      }
      if (orderScope.kind === 'invalid_shop') {
        return NextResponse.json(
          { error: 'Integration is missing a Jumia shop ID' },
          { status: 400 }
        );
      }
    }

    let query = supabase
      .from('jumia_orders')
      .select(
        'id, merchant_id, jumia_order_id, jumia_order_number, jumia_shop_id, status, customer_name, customer_phone, shipping_address, items, total_amount, currency, created_at_jumia, synced_at, updated_at, baci_order_id, notification_sent'
      )
      .eq('merchant_id', merchantId)
      .order('synced_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (orderScope?.kind === 'ok') {
      query = query
        .eq('jumia_shop_id', orderScope.shopId)
        .in('marketplace_key', orderScope.cachedMarketplaceKeys);
    }
    if (status) query = query.eq('status', status);
    const { data: orders, error: ordersError } = await query;
    if (ordersError) {
      console.error('[Jumia Orders] Database error:', ordersError);
      return NextResponse.json(
        { error: 'Failed to fetch orders' },
        { status: 500 }
      );
    }
    return NextResponse.json({
      orders: orders || [],
      count: orders?.length || 0,
    });
  } catch (error) {
    console.error('[Jumia Orders] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
