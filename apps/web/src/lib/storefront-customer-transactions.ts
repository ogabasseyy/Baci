import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

export interface StorefrontCustomerTransaction {
  id: string | null;
  order_id: string;
  amount: number | string | null;
  created_at: string;
  description: string | null;
  metadata: Record<string, string> | null;
  gateway: string | null;
  status: string | null;
  transaction_type: string | null;
}

interface CustomerTransactionRpcRow {
  id: string | null;
  order_id: string;
  amount: number | string | null;
  created_at: string;
  description: string | null;
  gateway: string | null;
  status: string | null;
  transaction_type: string | null;
  dva_account_number: string | null;
}

const MAX_ORDER_IDS_PER_LOOKUP = 100;

function toCustomerTransaction(
  row: CustomerTransactionRpcRow
): StorefrontCustomerTransaction {
  return {
    id: row.id,
    order_id: row.order_id,
    amount: row.amount,
    created_at: row.created_at,
    description: row.description,
    metadata: row.dva_account_number
      ? { dva_account_number: row.dva_account_number }
      : null,
    gateway: row.gateway,
    status: row.status,
    transaction_type: row.transaction_type,
  };
}

export async function loadStorefrontCustomerTransactions(
  supabase: SupabaseClient<Database>,
  orderIds: readonly string[]
) {
  if (orderIds.length === 0) {
    return {
      data: [] as StorefrontCustomerTransaction[],
      error: null,
    };
  }

  const data: CustomerTransactionRpcRow[] = [];
  let error: unknown = null;
  const uniqueOrderIds = [...new Set(orderIds)];

  for (
    let offset = 0;
    offset < uniqueOrderIds.length;
    offset += MAX_ORDER_IDS_PER_LOOKUP
  ) {
    const { data: batch, error: batchError } = await supabase.rpc(
      'get_customer_order_transactions',
      {
        p_order_ids: uniqueOrderIds.slice(
          offset,
          offset + MAX_ORDER_IDS_PER_LOOKUP
        ),
      }
    );
    if (batchError) {
      error = batchError;
      break;
    }
    data.push(...((batch ?? []) as CustomerTransactionRpcRow[]));
  }

  return {
    data: data.map(toCustomerTransaction),
    error,
  };
}
