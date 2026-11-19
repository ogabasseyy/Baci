import { MOBILE_ADMIN_PRODUCT_COLUMNS_PUBLIC as PRODUCT_COLUMNS_PUBLIC } from '@baci/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMerchant } from '@/hooks/useMerchant';
import type { Product } from '@/hooks/useProducts';
import type { AnalyticsDateRange } from '@/lib/analytics-period';
import { normalizeProductInventory } from '@/lib/product-inventory';
import { supabase } from '@/lib/supabase';

interface TopProductRpcResult {
  id: string;
  name: string;
  revenue: number;
  units: number;
}

export interface TopSellingProduct extends Product {
  totalSold: number;
  totalRevenue: number;
}

const ALL_TIME_START_ISO = new Date(0).toISOString();
const ALL_TIME_END_ISO = '9999-12-31T23:59:59.999Z';

export function useTopSellingProducts(
  limit: number = 20,
  range?: AnalyticsDateRange
) {
  const { merchant } = useMerchant();
  const merchantId = merchant?.id;
  const startDate = range?.startDate
    ? range.startDate.toISOString()
    : ALL_TIME_START_ISO;
  const endDate = range?.endDate
    ? range.endDate.toISOString()
    : ALL_TIME_END_ISO;

  return useQuery({
    queryKey: ['top-selling-products', merchant?.id, limit, startDate, endDate],
    queryFn: async () => {
      if (!merchantId) {
        return [];
      }

      const { data, error } = await supabase.rpc('get_top_products', {
        p_merchant_id: merchantId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_limit: limit,
      });

      if (error) throw error;

      const rpcData = data as TopProductRpcResult[];
      if (!rpcData?.length) return [];

      const productIds = rpcData.map((item) => item.id);
      const [productsResult, costsResult] = await Promise.all([
        supabase
          .from('products')
          .select(PRODUCT_COLUMNS_PUBLIC)
          .in('id', productIds)
          .eq('merchant_id', merchantId),
        supabase
          .from('merchant_analytics_product_costs')
          .select('id, cost_price')
          .in('id', productIds)
          .eq('merchant_id', merchantId),
      ]);

      if (productsResult.error) throw productsResult.error;

      const costById = new Map<string, number | null>();
      if (!costsResult.error && Array.isArray(costsResult.data)) {
        for (const costRow of costsResult.data) {
          costById.set(costRow.id, costRow.cost_price ?? null);
        }
      }

      const productsMap = new Map(
        productsResult.data?.map((product) => [
          product.id,
          {
            ...product,
            cost_price: costById.get(product.id) ?? null,
          },
        ])
      );

      return rpcData
        .map((item) => {
          const product = productsMap.get(item.id);
          if (!product) {
            return null;
          }

          return {
            ...normalizeProductInventory(product),
            totalSold: Number(item.units),
            totalRevenue: Number(item.revenue),
          };
        })
        .filter(Boolean) as TopSellingProduct[];
    },
    enabled: !!merchant?.id,
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  });
}
