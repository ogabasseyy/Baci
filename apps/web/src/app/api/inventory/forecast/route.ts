import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { parseRequestedMerchantId } from '@/app/api/branches/branch-route-utils';
import { hasPermission } from '@/lib/api-auth';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { analyticsDashboardSpecializedSchemas } from '@/schemas/analytics-dashboard-specialized';

/**
 * Inventory Forecasting API
 *
 * GET - Get inventory forecasts for all products or specific products
 *
 * Query params:
 * - productId: string (optional, get forecast for single product)
 * - lowStockOnly: boolean (default false, only show low stock items)
 * - page: number
 * - limit: number
 */

interface ForecastData {
  current_stock: number;
  avg_daily_sales: number;
  days_of_stock: number;
  predicted_stockout_date: string | null;
  reorder_quantity: number;
  sales_trend: 'increasing' | 'decreasing' | 'stable';
}

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
      analyticsDashboardSpecializedSchemas.inventoryForecastQuery.safeParse({
        limit: searchParams.get('limit') ?? undefined,
        lowStockOnly: searchParams.get('lowStockOnly') ?? undefined,
        page: searchParams.get('page') ?? undefined,
        productId: searchParams.get('productId') ?? undefined,
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
    const { limit, lowStockOnly, page, productId } = parsedQuery.data;
    const offset = (page - 1) * limit;

    // If specific product requested
    if (productId) {
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('id, name, image, low_stock_threshold')
        .eq('merchant_id', merchantId)
        .eq('id', productId)
        .maybeSingle();

      if (productError) {
        return NextResponse.json(
          { error: 'Failed to fetch product' },
          { status: 500 }
        );
      }
      if (!product) {
        return NextResponse.json(
          { error: 'Product not found' },
          { status: 404 }
        );
      }

      const { data: forecastRaw, error } = await supabase
        .rpc('calculate_inventory_forecast', {
          p_merchant_id: merchantId,
          p_product_id: productId,
          p_variant_id: null,
        })
        .single();

      if (error) {
        console.error('Error calculating forecast:', error);
        return NextResponse.json(
          { error: 'Failed to calculate forecast' },
          { status: 500 }
        );
      }

      const forecast = forecastRaw as ForecastData | null;

      return NextResponse.json({
        forecast: {
          productId,
          productName: product?.name || 'Unknown',
          image: product?.image,
          currentStock: forecast?.current_stock || 0,
          lowStockThreshold: product?.low_stock_threshold || 5,
          avgDailySales: forecast?.avg_daily_sales || 0,
          daysOfStock: forecast?.days_of_stock || 0,
          predictedStockoutDate: forecast?.predicted_stockout_date,
          reorderQuantity: forecast?.reorder_quantity || 0,
          salesTrend: forecast?.sales_trend || 'stable',
          status: getStockStatus(
            forecast?.current_stock || 0,
            forecast?.days_of_stock ?? null,
            product?.low_stock_threshold || 5
          ),
        },
      });
    }

    const { data: dashboard, error: dashboardError } = await supabase.rpc(
      'get_inventory_forecast_dashboard',
      {
        p_limit: limit,
        p_low_stock_only: lowStockOnly,
        p_merchant_id: merchantId,
        p_offset: offset,
      }
    );

    if (dashboardError) {
      console.error(
        'Error fetching inventory forecast dashboard:',
        dashboardError
      );
      return NextResponse.json(
        { error: 'Failed to calculate forecast' },
        { status: 500 }
      );
    }
    const payload = (dashboard ?? {}) as {
      forecasts?: unknown[];
      summary?: {
        critical?: number;
        healthy?: number;
        outOfStock?: number;
        totalProducts?: number;
        warning?: number;
      };
    };
    const forecasts = Array.isArray(payload.forecasts) ? payload.forecasts : [];
    const summary = {
      critical: payload.summary?.critical ?? 0,
      healthy: payload.summary?.healthy ?? 0,
      outOfStock: payload.summary?.outOfStock ?? 0,
      totalProducts: payload.summary?.totalProducts ?? 0,
      warning: payload.summary?.warning ?? 0,
    };

    return NextResponse.json({
      forecasts,
      summary,
      pagination: {
        page,
        limit,
        total: summary.totalProducts,
        totalPages: Math.ceil(summary.totalProducts / limit),
      },
    });
  } catch (error) {
    console.error('Inventory forecast error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function getStockStatus(
  stock: number,
  daysOfStock: number | null,
  threshold: number
): 'healthy' | 'warning' | 'critical' | 'out_of_stock' {
  if (stock <= 0) return 'out_of_stock';
  if (stock <= threshold || (daysOfStock !== null && daysOfStock <= 7))
    return 'critical';
  if (daysOfStock !== null && daysOfStock <= 14) return 'warning';
  return 'healthy';
}
