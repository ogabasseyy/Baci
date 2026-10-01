import type { OrderPaymentAccountLike } from '@baci/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

export interface StorefrontCustomerPaymentAccount
  extends OrderPaymentAccountLike {
  order_id: string;
}

interface CustomerPaymentAccountRpcRow {
  order_id: string;
  account_number: string;
  bank_name: string | null;
  account_name: string | null;
  provider: string | null;
  assignment_customer_email_source: string | null;
  created_at: string | null;
  assigned_at: string | null;
  expires_at: string | null;
}

const MAX_ORDER_IDS_PER_LOOKUP = 100;

function toCustomerPaymentAccount(
  row: CustomerPaymentAccountRpcRow
): StorefrontCustomerPaymentAccount {
  return {
    order_id: row.order_id,
    account_number: row.account_number,
    bank_name: row.bank_name,
    account_name: row.account_name,
    provider: row.provider,
    assignment_customer_email_source: row.assignment_customer_email_source,
    created_at: row.created_at,
    assigned_at: row.assigned_at,
    expires_at: row.expires_at,
  };
}

export async function loadStorefrontCustomerPaymentAccounts(
  supabase: SupabaseClient<Database>,
  orderIds: readonly string[]
) {
  if (orderIds.length === 0) {
    return {
      data: [] as StorefrontCustomerPaymentAccount[],
      error: null,
    };
  }

  const data: StorefrontCustomerPaymentAccount[] = [];
  let error: unknown = null;
  const uniqueOrderIds = [...new Set(orderIds)];

  for (
    let offset = 0;
    offset < uniqueOrderIds.length;
    offset += MAX_ORDER_IDS_PER_LOOKUP
  ) {
    const { data: batch, error: batchError } = await supabase.rpc(
      'get_customer_order_payment_accounts',
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
    data.push(
      ...((batch ?? []) as CustomerPaymentAccountRpcRow[]).map(
        toCustomerPaymentAccount
      )
    );
  }

  return { data, error };
}
