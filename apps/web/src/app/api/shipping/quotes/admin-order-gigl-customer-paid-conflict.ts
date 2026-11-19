import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { loadOrderGiglInternalCreditRetainedAmount } from '@/lib/shipping/load-order-gigl-internal-credit-retained-amount';
import { loadOrderGiglSettledRetainedAmount } from '@/lib/shipping/load-order-gigl-settled-retained-amount';

export const CUSTOMER_PAID_GIGL_SHIPPING_CODE = 'CUSTOMER_PAID_GIGL_SHIPPING';

/** Raised by bind_admin_gigl_quote once settlement retained the shipping. */
export const CUSTOMER_CHECKOUT_REBIND_FORBIDDEN =
  'customer_checkout_wallet_rebind_forbidden';

export function customerPaidGiglShippingResponse(): NextResponse {
  return NextResponse.json(
    {
      code: CUSTOMER_PAID_GIGL_SHIPPING_CODE,
      error:
        'The customer already paid for GIG delivery at checkout. Book this order from Ship Order to use the price they paid.',
    },
    { status: 409 }
  );
}

/**
 * Refuses an admin (wallet) GIG quote only while Baci actually holds the
 * customer's shipping money: settled retention (the rule the database bind
 * enforces) or completed internal-credit retention (counted by booking).
 * Zero-retained checkout orders (quiz voucher, Credit Direct, manual, cash,
 * still unsettled) stay on the wallet path, matching the bind contract.
 */
export async function getAdminOrderGiglCustomerPaidConflict(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  order: { shipping_funding_source?: string | null }
): Promise<NextResponse | null> {
  if (order.shipping_funding_source !== 'customer_checkout') return null;

  let heldAmount: number;
  try {
    const settled = await loadOrderGiglSettledRetainedAmount(
      supabase,
      merchantId,
      orderId
    );
    heldAmount =
      settled > 0
        ? settled
        : await loadOrderGiglInternalCreditRetainedAmount(
            supabase,
            merchantId,
            orderId,
            { shipping_funding_source: 'customer_checkout' }
          );
  } catch {
    // Fail closed: never let a wallet quote replace a possibly paid one.
    return NextResponse.json(
      {
        code: 'CHECKOUT_SHIPPING_PAYMENT_LOOKUP_FAILED',
        error:
          'Could not check what the customer paid for delivery. Please try again.',
      },
      { status: 503 }
    );
  }

  return heldAmount > 0 ? customerPaidGiglShippingResponse() : null;
}
