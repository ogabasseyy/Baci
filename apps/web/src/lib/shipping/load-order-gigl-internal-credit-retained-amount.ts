import type { SupabaseClient } from '@supabase/supabase-js';

export type ProjectedGiglCheckoutRetention = {
  shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
  shipping_platform_retained_amount?: number | string | null;
};

function parseRetainedShippingAmount(
  value: number | string | null | undefined
): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? Math.max(0, parsed)
    : 0;
}

/**
 * Customer wallet / savings / store-credit checkouts never create
 * merchant_settlements retention rows the way Paystack does. Read completed
 * internal-credit evidence through the merchant/staff-authorized projection
 * (transactions plus order-scoped redemption ledgers for partial mixed-credit
 * checkouts that never finalize into `transactions`). Callers combine this
 * with settlement retention and cap at the tariff.
 */
export async function loadOrderGiglInternalCreditRetainedAmount(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  projectedRetention: ProjectedGiglCheckoutRetention
): Promise<number> {
  if (projectedRetention.shipping_funding_source !== 'customer_checkout') {
    return 0;
  }

  if (typeof supabase.rpc !== 'function') {
    throw new Error(
      'Internal-credit retention lookup requires a Supabase client with rpc.'
    );
  }

  const result = await supabase.rpc(
    'get_order_gigl_internal_credit_retained_amount',
    {
      p_merchant_id: merchantId,
      p_order_id: orderId,
    }
  );

  if (!result || typeof result !== 'object') {
    throw new Error('Failed to load internal-credit GIGL retention.');
  }

  const typedResult = result as {
    data?: unknown;
    error?: { message?: string } | null;
  };

  if (typedResult.error) {
    throw new Error(
      `Failed to load internal-credit GIGL retention: ${
        typedResult.error.message ?? 'unknown error'
      }`
    );
  }

  return parseRetainedShippingAmount(
    typedResult.data as number | string | null | undefined
  );
}
