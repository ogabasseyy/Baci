import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminReconciliationQuery } from '@/schemas/admin-reconciliation-query';
import {
  type AdminReconciliationData,
  adminReconciliationRpcSchema,
} from '@/schemas/admin-reconciliation-rpc';
import type { Database } from '@/types/supabase';

interface AdminReconciliationError {
  code?: string | null;
  message: string;
}

type ReconciliationRpcClient = {
  rpc: (
    functionName: 'get_admin_reconciliation_v3',
    arguments_: {
      p_cursor_created_at: string | null;
      p_cursor_id: string | null;
      p_currency: string;
      p_lane: AdminReconciliationQuery['lane'];
      p_limit: number;
      p_merchant_id: string | null;
      p_period: AdminReconciliationQuery['period'];
      p_status: AdminReconciliationQuery['status'];
    }
  ) => Promise<{ data: unknown; error: AdminReconciliationError | null }>;
};

/**
 * Calls the admin-only SQL read model through the authenticated server client.
 * The narrow local contract fixes the permitted RPC and its safe projection; no
 * direct table reads or privileged client are used.
 */
export async function getAdminReconciliation(
  supabase: SupabaseClient<Database>,
  query: AdminReconciliationQuery
): Promise<{
  data: AdminReconciliationData | null;
  error: AdminReconciliationError | null;
}> {
  const rpcClient = supabase as unknown as ReconciliationRpcClient;
  const rpcResult = await rpcClient.rpc('get_admin_reconciliation_v3', {
    p_cursor_created_at: query.cursorAt ?? null,
    p_cursor_id: query.cursorId ?? null,
    p_currency: query.currency,
    p_lane: query.lane,
    p_limit: query.limit,
    p_merchant_id: query.merchantId ?? null,
    p_period: query.period,
    p_status: query.status,
  });

  if (rpcResult.error) {
    return { data: null, error: rpcResult.error };
  }

  const parsed = adminReconciliationRpcSchema.safeParse(rpcResult.data);
  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: 'INVALID_RECONCILIATION_PAYLOAD',
        message: 'Reconciliation read model returned an invalid payload.',
      },
    };
  }

  return { data: parsed.data, error: null };
}
