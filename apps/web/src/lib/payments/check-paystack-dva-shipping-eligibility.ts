import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolvePaystackSplitTransactionCharge } from '@/lib/payments/resolve-paystack-split-transaction-charge';

export type PaystackDvaShippingEligibility =
  | { ok: true }
  | { ok: false; code: string; message: string; status: number };

/**
 * Paystack DVA payments to a merchant subaccount give Baci nothing, so an
 * order that still owes Baci a customer-paid GIG delivery fee must pay by
 * card. Fails closed when the fee cannot be read.
 */
export async function checkPaystackDvaShippingEligibility(args: {
  amountKobo: number;
  client: Pick<SupabaseClient, 'rpc'>;
  customerEmail: string;
  merchantId: string;
  orderId: string;
  platformFeeKobo: number;
}): Promise<PaystackDvaShippingEligibility> {
  let retainedShippingKobo: number;
  try {
    ({ retainedShippingKobo } =
      await resolvePaystackSplitTransactionCharge(args));
  } catch (error) {
    console.error('Paystack DVA retained shipping check failed:', error);
    return {
      code: 'PAYMENT_SPLIT_RESOLUTION_FAILED',
      message: 'Bank transfer is temporarily unavailable. Please pay by card.',
      ok: false,
      status: 503,
    };
  }
  if (retainedShippingKobo > 0) {
    return {
      code: 'PAYMENT_METHOD_UNAVAILABLE_FOR_SHIPPING',
      message:
        'Bank transfer is not available for orders with GIG delivery yet. Please pay by card.',
      ok: false,
      status: 409,
    };
  }
  return { ok: true };
}
