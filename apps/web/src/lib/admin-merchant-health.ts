import type { SupabaseClient } from '@supabase/supabase-js';
import { adminMerchantHealthRowsSchema } from '@/schemas/admin-merchant-health-rpc';
import type { AdminMerchantsQuery } from '@/schemas/admin-merchants-query';
import type { AdminMerchantHealthRow } from '@/types/admin-merchants';
import type { Database } from '@/types/supabase';

function toRpcArgs(query: AdminMerchantsQuery) {
  return {
    p_health_status: query.health === 'all' ? null : query.health,
    p_limit: query.limit,
    p_offset: query.offset,
    p_search: query.search || null,
    p_sort_by: query.sortBy,
  };
}

export async function getAdminMerchantHealthPage(
  supabase: SupabaseClient<Database>,
  query: AdminMerchantsQuery
): Promise<{
  data: AdminMerchantHealthRow[];
  error: { code?: string | null; message?: string | null } | null;
  total: number;
}> {
  const rpcResult = await supabase.rpc(
    'get_admin_merchant_health_v2',
    toRpcArgs(query)
  );
  if (rpcResult.error) {
    return { data: [], error: rpcResult.error, total: 0 };
  }
  const parsed = adminMerchantHealthRowsSchema.safeParse(rpcResult.data);
  if (!parsed.success) {
    return {
      data: [],
      error: {
        code: 'INVALID_MERCHANT_HEALTH_PAYLOAD',
        message: 'Merchant health RPC returned an invalid payload',
      },
      total: 0,
    };
  }
  const data = parsed.data;
  if (data.length > 0 || query.offset === 0) {
    return {
      data,
      error: null,
      total: data[0]?.total_count ?? 0,
    };
  }

  // Window counts are absent on an offset page with no rows. Read the first
  // matching row only to retain the filtered total for the pagination UI.
  const countResult = await supabase.rpc('get_admin_merchant_health_v2', {
    ...toRpcArgs(query),
    p_limit: 1,
    p_offset: 0,
  });
  if (countResult.error) {
    return { data: [], error: countResult.error, total: 0 };
  }
  const countRows = adminMerchantHealthRowsSchema.safeParse(countResult.data);
  if (!countRows.success) {
    return {
      data: [],
      error: {
        code: 'INVALID_MERCHANT_HEALTH_PAYLOAD',
        message: 'Merchant health RPC returned an invalid payload',
      },
      total: 0,
    };
  }

  return {
    data: parsed.data,
    error: null,
    total: countRows.data[0]?.total_count ?? 0,
  };
}
