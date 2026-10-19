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
 * Customer Segments API
 *
 * GET - Get customer segment summary and list of customers by segment
 * POST - Refresh customer segments (triggers RFM recalculation)
 *
 * Query params (GET):
 * - segment: string (filter by specific segment)
 * - page: number
 * - limit: number
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
      analyticsDashboardSpecializedSchemas.customerSegmentsQuery.safeParse({
        limit: searchParams.get('limit') ?? undefined,
        page: searchParams.get('page') ?? undefined,
        segment: searchParams.get('segment') ?? undefined,
      });
    if (!parsedQuery.success) {
      return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
    }

    const requestedMerchant = parseRequestedMerchantId(request);
    if (requestedMerchant.response) {
      return requestedMerchant.response;
    }

    // Get merchant context (supports both owners and staff members)
    const merchantContext = await getMerchantForApiRequest(supabase, user.id, {
      requestedMerchantId: requestedMerchant.merchantId,
    });
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'customers', 'view')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const merchantId = merchantContext.merchantId;
    const { limit, page, segment } = parsedQuery.data;
    const offset = (page - 1) * limit;

    // Get segment summary
    const { data: summary, error: summaryError } = await supabase
      .from('customer_segment_summary')
      .select(
        'merchant_id, segment_name, customer_count, total_revenue, avg_clv'
      )
      .eq('merchant_id', merchantId);

    if (summaryError) {
      console.error('Error fetching customer segment summary:', summaryError);
      return NextResponse.json(
        { error: 'Failed to fetch segment summary' },
        { status: 500 }
      );
    }

    // Get customers with RFM scores
    let query = supabase
      .from('customer_rfm_scores')
      .select(
        `
        customer_id, rfm_segment, lifecycle_segment, recency_score, frequency_score, monetary_score, total_orders, total_spent, average_order_value, days_since_last_order, first_order_date, last_order_date, predicted_clv, churn_risk, updated_at,
        customers (
          id,
          name,
          email,
          phone,
          store_credit,
          created_at
        )
      `,
        { count: 'exact' }
      )
      .eq('merchant_id', merchantId)
      .order('predicted_clv', { ascending: false })
      .range(offset, offset + limit - 1);

    if (segment) {
      query = query.eq('rfm_segment', segment);
    }

    const { data: customers, error, count } = await query;

    if (error) {
      console.error('Error fetching customer segments:', error);
      return NextResponse.json(
        { error: 'Failed to fetch segments' },
        { status: 500 }
      );
    }

    // Get segment definitions
    const { data: definitions } = await supabase
      .from('segment_definitions')
      .select(
        'id, segment_name, display_name, description, color, priority, merchant_id'
      )
      .or(`merchant_id.is.null,merchant_id.eq.${merchantId}`)
      .order('priority', { ascending: false });

    return NextResponse.json({
      customers: customers?.map((c) => ({
        customerId: c.customer_id,
        customer: c.customers,
        rfmSegment: c.rfm_segment,
        lifecycleSegment: c.lifecycle_segment,
        recencyScore: c.recency_score,
        frequencyScore: c.frequency_score,
        monetaryScore: c.monetary_score,
        rfmScore: `${c.recency_score}${c.frequency_score}${c.monetary_score}`,
        totalOrders: c.total_orders,
        totalSpent: c.total_spent,
        averageOrderValue: c.average_order_value,
        daysSinceLastOrder: c.days_since_last_order,
        firstOrderDate: c.first_order_date,
        lastOrderDate: c.last_order_date,
        predictedClv: c.predicted_clv,
        churnRisk: c.churn_risk,
        updatedAt: c.updated_at,
      })),
      summary: summary || [],
      definitions: definitions || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('Customer segments GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(_request: NextRequest) {
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
      await checkCsrfProtection(_request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const requestedMerchant = parseRequestedMerchantId(_request);
    if (requestedMerchant.response) {
      return requestedMerchant.response;
    }

    // Get merchant context (supports both owners and staff members)
    const merchantContext = await getMerchantForApiRequest(supabase, user.id, {
      requestedMerchantId: requestedMerchant.merchantId,
    });
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'customers', 'create')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const merchantId = merchantContext.merchantId;

    // Trigger segment refresh
    const { data: result, error } = await supabase.rpc(
      'refresh_customer_segments',
      {
        p_merchant_id: merchantId,
      }
    );

    if (error) {
      console.error('Error refreshing segments:', error);
      return NextResponse.json(
        { error: 'Failed to refresh segments' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      customersProcessed: result,
      message: `Successfully refreshed segments for ${result} customers`,
    });
  } catch (error) {
    console.error('Customer segments POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
