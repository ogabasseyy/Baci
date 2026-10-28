import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

export interface StorefrontCustomerTaxSubtotal {
  order_id: string;
  vat_category_code: string | null;
  vat_rate: number | string | null;
  taxable_amount: number | string | null;
  tax_amount: number | string | null;
  exemption_reason: string | null;
}

interface CustomerTaxSubtotalRpcRow {
  order_id: string;
  vat_category_code: string | null;
  vat_rate: number | string | null;
  taxable_amount: number | string | null;
  tax_amount: number | string | null;
  exemption_reason: string | null;
}

const MAX_ORDER_IDS_PER_LOOKUP = 100;

export async function loadStorefrontCustomerTaxSubtotals(
  supabase: SupabaseClient<Database>,
  orderIds: readonly string[]
) {
  if (orderIds.length === 0) {
    return {
      data: [] as StorefrontCustomerTaxSubtotal[],
      error: null,
    };
  }

  const data: CustomerTaxSubtotalRpcRow[] = [];
  let error: unknown = null;
  const uniqueOrderIds = [...new Set(orderIds)];

  for (
    let offset = 0;
    offset < uniqueOrderIds.length;
    offset += MAX_ORDER_IDS_PER_LOOKUP
  ) {
    const { data: batch, error: batchError } = await supabase.rpc(
      'get_customer_order_tax_subtotals',
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
    data.push(...((batch ?? []) as CustomerTaxSubtotalRpcRow[]));
  }

  return {
    data,
    error,
  };
}
