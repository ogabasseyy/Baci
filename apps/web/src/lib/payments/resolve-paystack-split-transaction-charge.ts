import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

const RETAINED_SHIPPING_RPC = 'get_order_paystack_split_retained_shipping_kobo';

interface ResolvePaystackSplitTransactionChargeInput {
  // The request-scoped client: the RPC is proof-bound (order, merchant and
  // the order's customer email), so no service-role client is needed.
  client: Pick<SupabaseClient, 'rpc'>;
  customerEmail: string;
  orderId: string;
  merchantId: string;
  amountKobo: number;
  platformFeeKobo: number;
}

export interface PaystackSplitTransactionCharge {
  transactionChargeKobo: number;
  retainedShippingKobo: number;
}

function assertKobo(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Paystack split ${label} is invalid`);
  }
}

/**
 * Computes the Paystack subaccount `transaction_charge` (the amount Baci keeps)
 * as platform fee + the customer-paid GIGL delivery fee still to be retained.
 * Fails closed: an unknown retained amount must never initialize a split,
 * otherwise the delivery fee would be paid out to the merchant's bank.
 */
export async function resolvePaystackSplitTransactionCharge({
  client,
  customerEmail,
  orderId,
  merchantId,
  amountKobo,
  platformFeeKobo,
}: ResolvePaystackSplitTransactionChargeInput): Promise<PaystackSplitTransactionCharge> {
  assertKobo(amountKobo, 'amount');
  assertKobo(platformFeeKobo, 'platform fee');
  if (platformFeeKobo > amountKobo) {
    throw new Error('Paystack split platform fee exceeds the payable amount');
  }

  const { data, error } = await client.rpc(RETAINED_SHIPPING_RPC, {
    p_email: customerEmail,
    p_merchant_id: merchantId,
    p_order_id: orderId,
  });
  if (error) {
    throw new Error('Paystack split retained shipping lookup failed');
  }
  if (typeof data !== 'number' || !Number.isSafeInteger(data) || data < 0) {
    throw new Error('Paystack split retained shipping is invalid');
  }

  // Mirrors the settlement clamp: retention can never exceed what remains
  // after the platform fee.
  const retainedShippingKobo = Math.min(
    data,
    Math.max(amountKobo - platformFeeKobo, 0)
  );
  const transactionChargeKobo = platformFeeKobo + retainedShippingKobo;
  if (transactionChargeKobo > amountKobo) {
    throw new Error('Paystack split charge exceeds the payable amount');
  }

  return { transactionChargeKobo, retainedShippingKobo };
}
