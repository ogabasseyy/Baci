import {
  getCheckoutOrderErrorMessage,
  getOrderCreateErrorCode,
  isQuizVoucherRejectionCode,
} from '../checkout-order-error-message';
import { normalizeOrderPaymentMethod } from '../pending-checkout-order';
import { createClient } from '@/lib/supabase/client';
import type { CheckoutOrderItem } from '@/lib/checkout/build-order-items';
import type { LegacyOrderData, PlaceOrderOptions } from './place-order-types';
import type { buildShippingAddress } from './place-order-shipping';

export async function createPlaceOrder(
  opts: PlaceOrderOptions,
  merchant: NonNullable<PlaceOrderOptions['merchant']>,
  shippingAddressData: ReturnType<typeof buildShippingAddress>,
  shippingProvider: string | null,
  orderItems: CheckoutOrderItem[]
): Promise<LegacyOrderData> {
  const {
    customerEmail,
    firstName,
    lastName,
    customerPhone,
    cartTotal,
    deliveryCost,
    taxAmount,
    giftWrappingCost,
    total,
    paymentMethod,
    selectedQuoteId,
    deliveryMethod,
    payWithWallet,
    walletAmountUsed,
    user,
    newsletterOptIn,
    pruneVoucherLines,
    createAccount: shouldCreateAccount,
    accountPassword,
  } = opts;
  // 1. Create order via API
  const orderResponse = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchant_id: merchant.id,
      customer_email: customerEmail,
      customer_name: `${firstName} ${lastName}`.trim(),
      customer_phone: customerPhone,
      items: orderItems,
      subtotal: cartTotal,
      shipping_fee: deliveryCost,
      // B3.5 (Δ-31, Δ-34, Δ-39): pass through what
      // calculate-commerce produced. No hidden fallback math here:
      // the RPC enforces VAT itself (Δ-42), and the API parity
      // check on `expected_total` (Δ-39) catches any drift between
      // what the customer was shown and what the server persists.
      tax_amount: taxAmount,
      tax_basis: 'exclusive',
      gift_wrapping_fee: giftWrappingCost,
      expected_total: total,
      client_total: total,
      payment_method: normalizeOrderPaymentMethod(paymentMethod),
      payment_status: 'unpaid',
      shipping_status: 'pending',
      shipping_address: shippingAddressData,
      source: 'online_store',
      shipping_provider: shippingProvider,
      // B3 review fix (PR #1611): explicit null on the wire AND
      // coerce empty string → null. `selectedQuoteId` is typed
      // string (`useState<string>('')`); `selectedQuoteId || null`
      // covers both empty string AND undefined defensively in case
      // the pre-submit door-no-quote guard above is bypassed by a
      // future refactor. Schemas are `.nullable().optional()`.
      selected_quote_id:
        deliveryMethod === 'door' || deliveryMethod === 'pickup_station'
          ? selectedQuoteId || null
          : null,
      use_wallet_credit: payWithWallet && walletAmountUsed > 0,
      wallet_amount: walletAmountUsed,
      user_id: user?.id,
      accepts_marketing: newsletterOptIn,
    }),
  });

  if (!orderResponse.ok) {
    const errorData = await orderResponse.json();
    console.error('Order creation failed:', {
      status: orderResponse.status,
      error: errorData.error,
      details: errorData.details,
      fullResponse: errorData,
    });
    // FIX E (2): a rejected quiz-prize voucher (expired / already-used /
    // not-approved) would otherwise re-fail every checkout. Drop the
    // offending voucher line so the shopper can proceed with the rest of
    // their cart. The friendly copy is surfaced by the throw below.
    if (isQuizVoucherRejectionCode(getOrderCreateErrorCode(errorData))) {
      pruneVoucherLines?.(
        typeof errorData.rejectedVoucherToken === 'string'
          ? errorData.rejectedVoucherToken
          : undefined
      );
    }
    // FIX C: map raw RPC codes (e.g. quiz_voucher_award_not_approved) to
    // actionable, shopper-facing copy instead of leaking the code to a toast.
    throw new Error(getCheckoutOrderErrorMessage(errorData));
  }

  const orderData: LegacyOrderData = await orderResponse.json();

  // 1b. Create account if requested
  if (shouldCreateAccount && !user && accountPassword.length >= 6) {
    try {
      const supabase = createClient();
      await supabase.auth.signUp({
        email: customerEmail,
        password: accountPassword,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            phone: customerPhone,
            source: 'checkout',
            signup_type: 'customer',
          },
        },
      });
    } catch (authError) {
      console.error('Silent signup background error:', authError);
    }
  }

  return orderData;
}
