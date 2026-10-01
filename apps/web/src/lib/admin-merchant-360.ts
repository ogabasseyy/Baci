import type { SupabaseClient } from '@supabase/supabase-js';
import { adminMerchant360RpcSchema } from '@/schemas/admin-merchant-360-rpc';
import { adminMerchantRouteParamsSchema } from '@/schemas/admin-merchant-route-params';
import type { AdminMerchant360Response } from '@/types/admin-merchant-360';
import type { Database } from '@/types/supabase';

type AdminMerchant360RpcClient = {
  rpc: (
    functionName: 'get_admin_merchant_360_v2',
    args: { p_merchant_id: string }
  ) => Promise<{
    data: unknown;
    error: { code?: string | null; message: string } | null;
  }>;
};

export type AdminMerchant360Result = {
  data: AdminMerchant360Response | null;
  error: { code?: string | null; message: string } | null;
};

/**
 * Reads the one bounded platform-admin RPC; never fan out to tenant tables.
 * Generated Supabase Database types must add this versioned RPC after migration.
 */
export async function getAdminMerchant360(
  supabase: SupabaseClient<Database>,
  merchantId: string
): Promise<AdminMerchant360Result> {
  const parseResult = adminMerchantRouteParamsSchema.safeParse({ merchantId });
  if (!parseResult.success) {
    return {
      data: null,
      error: { code: 'INVALID_MERCHANT_ID', message: 'Invalid merchant ID' },
    };
  }

  const rpcClient = supabase as unknown as AdminMerchant360RpcClient;
  const rpcResult = await rpcClient.rpc('get_admin_merchant_360_v2', {
    p_merchant_id: parseResult.data.merchantId,
  });

  if (rpcResult.error) {
    return { data: null, error: rpcResult.error };
  }

  if (rpcResult.data === null) {
    return { data: null, error: null };
  }

  const parsed = adminMerchant360RpcSchema.safeParse(rpcResult.data);
  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: 'INVALID_MERCHANT_360_PAYLOAD',
        message: 'Merchant operations snapshot returned an invalid payload',
      },
    };
  }

  return { data: parsed.data, error: null };
}
