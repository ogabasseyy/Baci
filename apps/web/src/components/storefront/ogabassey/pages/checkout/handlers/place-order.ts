import { toast } from '@/hooks/use-toast';
import {
  CHECKOUT_FUNNEL_EVENTS,
  buildCheckoutFunnelProperties,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';
import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import { toCreditDirectItems } from '@/lib/checkout/credit-direct-items';
import {
  getCheckoutOrderErrorMessage,
  getOrderCreateErrorCode,
  isQuizVoucherRejectionCode,
} from '../checkout-order-error-message';
import { openCredPalCheckout } from '@/lib/credpal';
import { openCreditDirectCheckout } from '@/lib/credit-direct-client';
import { createClient } from '@/lib/supabase/client';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { writeCreditDirectPopupMarker } from '../credit-direct-popup-return';
import { captureCreditDirectClientCompletion } from '../credit-direct-client-completion';
import { normalizeOrderPaymentMethod } from '../pending-checkout-order';
import { persistCreditDirectPopupReference } from '../persist-credit-direct-popup-reference';
import {
  KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST,
  getStationPickupAddressText,
  isStationPickupQuote,
  isKlumpUnavailableForGatewayAmount,
} from '../utils';
import type {
  DeliveryMethod,
  SavedAddress,
  ShippingQuote,
  PaymentMethod,
  CryptoPaymentData,
  PendingCryptoOrder,
  ResumedOrder,
} from '../types';

export interface CheckoutCartItem {
  id: string | number;
  name: string;
  quantity: number;
  price: number;
  negotiatedPrice?: number;
  hasAssurance?: boolean;
  assuranceRate?: number;
  variantId?: string;
  variantAttributes?: Record<string, string>;
  selectedColor?: string;
  selectedStorage?: string;
  quizAwardId?: string;
  quizVoucherToken?: string;
}

export interface PlaceOrderOptions {
  merchant: { id: string; slug: string } | null | undefined;
  /**
   * Merchant-resolved order currency code (e.g. 'NGN', 'KES'). Sent to
   * /api/payments/initialize instead of a hardcoded 'NGN'; the server derives
   * the authoritative charge currency from the order and rejects a mismatch.
   */
  currency: string;
  customerEmail: string;
  firstName: string;
  lastName: string;
  customerPhone: string;
  deliveryMethod: DeliveryMethod;
  isNewAddressMode: boolean;
  newAddressStreet: string;
  newAddressCity: string;
  newAddressState: string;
  selectedAddressId: number;
  addresses: SavedAddress[];
  airportType: 'delivery' | 'pickup';
  cart: CheckoutCartItem[];
  cartTotal: number;
  deliveryCost: number;
  total: number;
  // B3.5 (Δ-31, Δ-34, Δ-39): VAT + gift-wrapping carried through to
  // the API so the RPC's VAT enforcement boundary (Δ-42) has the
  // figures the user was shown, and the API's parity check (Δ-39)
  // can compare client expected_total vs server-recomputed total.
  taxAmount: number;
  giftWrappingCost: number;
  selectedQuoteId: string;
  shippingQuotes: ShippingQuote[];
  paymentMethod: PaymentMethod;
  payWithWallet: boolean;
  walletAmountUsed: number;
  createAccount: boolean;
  accountPassword: string;
  newsletterOptIn: boolean;
  user: { id: string } | null | undefined;
  payForMeDetails: { name: string; contact: string; note: string };
  resumedOrder: ResumedOrder | null;
  preferredGateway: 'credpal' | 'credit_direct' | null;
  isOrderInFlightRef: { current: boolean };
  setIsProcessing: (v: boolean) => void;
  setWalletBalance: (v: number) => void;
  setCurrentStep: (v: 'contact' | 'delivery' | 'payment') => void;
  setCompletedSteps: (v: { contact: boolean; delivery: boolean }) => void;
  clearCheckoutSession: () => void;
  clearCart: () => void;
  /**
   * FIX E: remove quiz-prize voucher line(s) from the cart. Invoked when the
   * orders RPC rejects the voucher (expired/already-used/not-approved) so the
   * offending line does not re-fail every subsequent checkout attempt.
   */
  pruneVoucherLines?: (rejectedVoucherToken?: string) => void;
  routerPush: (url: string) => void;
  getHref: (path: string) => string;
  executeDirectPayment: () => Promise<void>;
  crypto: {
    setPendingCryptoOrder: (order: PendingCryptoOrder) => void;
    setShowCryptoSelector: (show: boolean) => void;
    setCryptoPaymentData: (data: CryptoPaymentData) => void;
  };
  dva: {
    handleBankTransfer: (
      order: { id: string },
      paymentAmount: number,
      isOrderInFlightRef: { current: boolean },
      setIsProcessing: (v: boolean) => void,
    ) => Promise<void>;
  };
}

function buildShippingAddress(opts: PlaceOrderOptions) {
  const {
    deliveryMethod,
    isNewAddressMode,
    newAddressStreet,
    newAddressCity,
    newAddressState,
    selectedAddressId,
    addresses,
    airportType,
    customerPhone,
    selectedQuoteId,
    shippingQuotes,
  } = opts;

  let finalAddress = 'Address not provided';
  let finalCity = '';
  let finalState = '';
  const selectedAddress = addresses.find((a) => a.id === selectedAddressId);

  if (deliveryMethod === 'door') {
    if (isNewAddressMode) {
      finalAddress = `${newAddressStreet}, ${newAddressCity}, ${newAddressState}`;
      finalCity = newAddressCity;
      finalState = newAddressState;
    } else {
      finalAddress = selectedAddress?.address || 'Address not provided';
      const parts = finalAddress.split(',');
      if (parts.length >= 2) {
        finalState = parts[parts.length - 1]?.trim() || '';
        finalCity = parts[parts.length - 2]?.trim() || '';
      }
    }
  } else if (deliveryMethod === 'pickup_station') {
    const selectedQuote = shippingQuotes.find(
      (quote) => String(quote.id) === String(selectedQuoteId),
    );
    finalAddress =
      (selectedQuote && getStationPickupAddressText(selectedQuote)) ||
      selectedQuote?.displayName ||
      'GIGL pickup station';
    finalCity = newAddressCity;
    finalState = newAddressState;
    if ((!finalCity || !finalState) && selectedAddress?.address) {
      const parts = selectedAddress.address.split(',');
      if (parts.length >= 2) {
        finalCity ||= parts[parts.length - 2]?.trim() || '';
        finalState ||= parts[parts.length - 1]?.trim() || '';
      }
    }
  } else if (deliveryMethod === 'pickup') {
    finalAddress = 'Pickup at Store';
    finalCity = 'Lagos';
    finalState = 'Lagos';
  } else if (deliveryMethod === 'airport') {
    finalAddress =
      newAddressStreet ||
      `Airport ${airportType === 'pickup' ? 'Pickup' : 'Delivery'}`;
    finalCity = newAddressCity || 'Airport';
    finalState = newAddressState || 'Nigeria';
  }

  return {
    address: finalAddress,
    city: finalCity,
    state: finalState,
    phone: customerPhone || selectedAddress?.phone || '',
  };
}

// B3 (plan §5 B3): only return a non-null third-party shipping provider
// when delivery is via a quoted carrier (door). Pickup and airport are
// delivery-method labels, not third-party shipping providers — sending
// 'Pickup'/'Airport' as `shipping_provider` would trip the RPC's new
// `shipping_quote_required` guard. Returning null lets the RPC bypass
// the guard for these flows.
//
// B3 review fix (PR #1611): when door + selectedQuoteId is set but the
// id doesn't resolve in the current `shippingQuotes` list (e.g. rates
// expired or got refreshed under us), we MUST NOT fabricate a
// 'Standard' provider — that lets the order submit with a dangling
// quote id and a phony provider, which is the exact data-integrity
// gap B3 closes. Return a discriminated result so the caller can
// surface a validation toast and bail. The inline checkout-page.tsx
// uses the same fail-closed pattern.
type ShippingProviderResolution =
  | { ok: true; provider: string | null }
  | { ok: false; reason: 'dangling_quote' };

function getShippingProvider(
  deliveryMethod: DeliveryMethod,
  selectedQuoteId: string,
  shippingQuotes: ShippingQuote[],
): ShippingProviderResolution {
  if (
    (deliveryMethod === 'door' || deliveryMethod === 'pickup_station') &&
    selectedQuoteId
  ) {
    const quote = shippingQuotes.find(
      (q) => String(q.id) === String(selectedQuoteId),
    );
    if (!quote) {
      return { ok: false, reason: 'dangling_quote' };
    }
    if (deliveryMethod === 'door' && isStationPickupQuote(quote)) {
      return { ok: false, reason: 'dangling_quote' };
    }
    if (deliveryMethod === 'pickup_station' && !isStationPickupQuote(quote)) {
      return { ok: false, reason: 'dangling_quote' };
    }
    return { ok: true, provider: quote.provider || null };
  }
  return { ok: true, provider: null };
}

export async function handlePlaceOrder(opts: PlaceOrderOptions): Promise<void> {
  const {
    merchant,
    currency,
    customerEmail,
    firstName,
    lastName,
    customerPhone,
    deliveryMethod,
    isNewAddressMode,
    newAddressStreet,
    newAddressCity,
    newAddressState,
    cart,
    cartTotal,
    deliveryCost,
    total,
    taxAmount,
    giftWrappingCost,
    selectedQuoteId,
    shippingQuotes,
    paymentMethod,
    payWithWallet,
    walletAmountUsed,
    createAccount: shouldCreateAccount,
    accountPassword,
    newsletterOptIn,
    user,
    payForMeDetails,
    resumedOrder,
    preferredGateway,
    isOrderInFlightRef,
    setIsProcessing,
    setWalletBalance,
    setCurrentStep,
    setCompletedSteps,
    clearCheckoutSession,
    clearCart,
    pruneVoucherLines,
    routerPush,
    getHref,
    executeDirectPayment,
    crypto,
    dva,
  } = opts;

  // Double-submit protection
  if (isOrderInFlightRef.current) return;
  isOrderInFlightRef.current = true;

  if (!merchant?.id) {
    toast({
      title: 'Error',
      description: 'Merchant context not available. Please try again.',
      variant: 'destructive',
    });
    isOrderInFlightRef.current = false;
    return;
  }

  if (!customerEmail || !firstName || !lastName) {
    toast({
      title: 'Missing Information',
      description: 'Please fill in your name and email.',
      variant: 'destructive',
    });
    isOrderInFlightRef.current = false;
    return;
  }

  setIsProcessing(true);

  // Handle resumed orders (order exists, just need payment)
  if (resumedOrder && preferredGateway) {
    await executeDirectPayment();
    return;
  }

  // Validate address for door delivery
  if (deliveryMethod === 'door' && isNewAddressMode) {
    if (!newAddressStreet || !newAddressCity || !newAddressState) {
      toast({
        title: 'Incomplete Address',
        description:
          'Please enter your full address (Street, City, State).',
        variant: 'destructive',
      });
      setIsProcessing(false);
      isOrderInFlightRef.current = false;
      return;
    }
  }

  const shippingAddressData = buildShippingAddress(opts);

  // B3 review fix #2 (PR #1611): block door delivery without ANY
  // selected quote BEFORE constructing the JSON body. Pre-fix, this
  // path sent `shipping_provider: null + selected_quote_id: null`,
  // which slipped past the RPC's `provider != null AND quote_id IS
  // NULL` guard (both null → guard doesn't fire) and persisted a
  // silent zero-shipping order. The RPC predicate alone cannot tell
  // legitimate "no shipping" (pickup/airport) from broken "door
  // without quote" — the client knows the deliveryMethod and is the
  // right place to enforce.
  if (
    (deliveryMethod === 'door' || deliveryMethod === 'pickup_station') &&
    !selectedQuoteId
  ) {
    toast({
      title: 'Delivery option required',
      description: 'Please select a delivery option to continue.',
      variant: 'destructive',
    });
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    return;
  }

  const shippingProviderResolution = getShippingProvider(
    deliveryMethod,
    selectedQuoteId,
    shippingQuotes,
  );
  if (!shippingProviderResolution.ok) {
    // B3 review fix #1: dangling selectedQuoteId (door delivery,
    // quote ref but no matching rate in the current list — usually
    // expired or refreshed under us). Surface a validation error and
    // bail instead of fabricating a 'Standard' provider; the customer
    // re-picks a quote from the freshly loaded rates.
    toast({
      title: 'Shipping rate expired',
      description: 'Please select a delivery option again.',
      variant: 'destructive',
    });
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    return;
  }
  const shippingProvider = shippingProviderResolution.provider;
  const clientPayableAmount = payWithWallet ? total - walletAmountUsed : total;
  const billingAddressLine1 =
    deliveryMethod === 'door' && isNewAddressMode
      ? newAddressStreet
      : shippingAddressData.address;

  if (
    isKlumpUnavailableForGatewayAmount({
      paymentMethod,
      payableAmount: clientPayableAmount,
      orderAmount: total,
    })
  ) {
    toast(KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST);
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    return;
  }

  const orderItems = buildCheckoutOrderItems(cart);
  let createdOrderId: string | undefined;
  let createdOrderNumber: string | undefined;

  try {
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
            : undefined,
        );
      }
      // FIX C: map raw RPC codes (e.g. quiz_voucher_award_not_approved) to
      // actionable, shopper-facing copy instead of leaking the code to a toast.
      throw new Error(getCheckoutOrderErrorMessage(errorData));
    }

    const orderData = await orderResponse.json();
    const { order, wallet: walletResult, amountDueToGateway } = orderData;
    createdOrderId = order.id;
    createdOrderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
    captureCheckoutFunnelEventOnce(
      CHECKOUT_FUNNEL_EVENTS.orderCreated,
      createdOrderId,
      buildCheckoutFunnelProperties({
        channel: 'web',
        itemCount: orderItems.reduce((count, item) => count + item.quantity, 0),
        orderId: createdOrderId,
        orderNumber: createdOrderNumber,
        paymentIntent: getCheckoutPaymentIntent(paymentMethod),
        paymentMethod,
        paymentStatus: order.payment_status || 'unpaid',
        shipping: deliveryCost,
        source: 'web_checkout',
        subtotal: cartTotal,
        tax: taxAmount,
        total: order.total,
      })
    );

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

    const paymentAmount = amountDueToGateway ?? total;
    const trackingParam = order.tracking_token
      ? `&trackingToken=${order.tracking_token}`
      : '';

    if (
      isKlumpUnavailableForGatewayAmount({
        paymentMethod,
        payableAmount: paymentAmount,
        orderAmount: total,
      })
    ) {
      toast(KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST);
      setIsProcessing(false);
      isOrderInFlightRef.current = false;
      return;
    }

    if (walletResult?.amountUsed) {
      setWalletBalance(walletResult.newBalance);
    }

    // 2. Route to payment gateway
    if (paymentAmount <= 0) {
      captureClientEvent(
        CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
        buildCheckoutFunnelProperties({
          channel: 'web',
          orderId: order.id,
          orderNumber: createdOrderNumber,
          paymentIntent: getCheckoutPaymentIntent(paymentMethod),
          paymentMethod,
          paymentStatus: 'paid',
          source: 'web_checkout',
          total: order.total,
        })
      );
      clearCheckoutSession();
      routerPush(
        getHref(
          `/order-success?orderId=${order.id}&wallet=true${trackingParam}`,
        ),
      );
      setTimeout(clearCart, 500);
      return;
    }

    if (paymentMethod === 'bank_transfer') {
      captureClientEvent(
        CHECKOUT_FUNNEL_EVENTS.paymentStarted,
        buildCheckoutFunnelProperties({
          channel: 'web',
          orderId: order.id,
          orderNumber: createdOrderNumber,
          paymentIntent: getCheckoutPaymentIntent(paymentMethod),
          paymentMethod,
          source: 'web_checkout',
          total: paymentAmount,
        })
      );
      await dva.handleBankTransfer(
        order,
        paymentAmount,
        isOrderInFlightRef,
        setIsProcessing,
      );
      return;
    }

    if (paymentMethod === 'juicyway') {
      captureClientEvent(
        CHECKOUT_FUNNEL_EVENTS.paymentStarted,
        buildCheckoutFunnelProperties({
          channel: 'web',
          orderId: order.id,
          orderNumber: createdOrderNumber,
          paymentIntent: getCheckoutPaymentIntent(paymentMethod),
          paymentMethod,
          source: 'web_checkout',
          total: paymentAmount,
        })
      );
      crypto.setPendingCryptoOrder({
        orderId: order.id,
        amount: paymentAmount,
        customerEmail,
        customerName: `${firstName} ${lastName}`.trim(),
        customerPhone,
        billingAddress: {
          line1: billingAddressLine1,
          city: shippingAddressData.city,
          state: shippingAddressData.state,
          country: 'NG',
          zip_code: '100001',
        },
        items: cart.map((item) => ({
          name: item.name,
          type: 'physical' as const,
        })),
        trackingToken: order.tracking_token,
      });
      crypto.setShowCryptoSelector(true);
      setIsProcessing(false);
      isOrderInFlightRef.current = false;
      return;
    }

    if (
      paymentMethod === 'paystack' ||
      paymentMethod === 'korapay' ||
      paymentMethod === 'klump'
    ) {
      captureClientEvent(
        CHECKOUT_FUNNEL_EVENTS.paymentStarted,
        buildCheckoutFunnelProperties({
          channel: 'web',
          orderId: order.id,
          orderNumber: createdOrderNumber,
          paymentIntent: getCheckoutPaymentIntent(paymentMethod),
          paymentMethod,
          source: 'web_checkout',
          total: paymentAmount,
        })
      );
      const result = await initializeCardPayment(
        merchant.id,
        order.id,
        currency,
        customerEmail,
        `${firstName} ${lastName}`.trim(),
        customerPhone,
        paymentMethod,
        {
          line1: billingAddressLine1,
          city: shippingAddressData.city || 'Lagos',
          state: shippingAddressData.state || 'Lagos',
          country: 'NG',
          zip_code: '100001',
        },
      );

      if (result.crypto_payment) {
        crypto.setCryptoPaymentData({
          address: result.crypto_payment.address,
          chain: result.crypto_payment.chain,
          currency: result.crypto_payment.currency,
          amount: result.crypto_payment.amount / 100,
          confirmation_time: result.crypto_payment.confirmation_time,
          orderId: order.id,
          reference: result.reference,
          sessionId: result.session_id || '',
          paymentId: result.crypto_payment.payment_id || '',
          trackingToken: order.tracking_token,
        });
        setIsProcessing(false);
        isOrderInFlightRef.current = false;
        return;
      }

      if (result.authorization_url) {
        window.location.href = result.authorization_url;
        return;
      }

      if (result.checkout_url) {
        window.location.href = result.checkout_url;
        return;
      }

      throw new Error('Payment initialization failed: No auth URL returned');
    }

    if (paymentMethod === 'credit_direct') {
      captureClientEvent(
        CHECKOUT_FUNNEL_EVENTS.paymentStarted,
        buildCheckoutFunnelProperties({
          channel: 'web',
          orderId: order.id,
          orderNumber: createdOrderNumber,
          paymentIntent: getCheckoutPaymentIntent(paymentMethod),
          paymentMethod,
          source: 'web_checkout',
          total: paymentAmount,
        })
      );
      // Weight the Credit Direct allocation by CANONICAL order-item prices
      // (negotiated applied, quiz vouchers 0), never the raw cart price — a
      // display price would finance a voucher item and under-allocate a paid
      // one. The resumed-order branch already carries persisted canonical prices.
      const items =
        cart.length > 0
          ? toCreditDirectItems(orderItems)
          : (resumedOrder?.items ?? []).map((item) => ({
              id: item.product_id,
              name: item.product_name,
              price: item.price,
              quantity: item.quantity,
            }));

      await openCreditDirectCheckout({
        merchantSlug: merchant.slug || '',
        orderId: order.id,
        trackingToken: order.tracking_token ?? '',
        amount: paymentAmount,
        customerEmail,
        customerPhone,
        customerName: `${firstName} ${lastName}`.trim(),
        items,
        onSuccess: ({ checkoutTransactionId, sessionId }) => {
          const completionMarker = captureCreditDirectClientCompletion({
            orderId: order.id,
            checkoutTransactionId,
            customerEmail,
            sessionId,
            trackingToken: order.tracking_token,
          });
          const verificationQuery = new URLSearchParams({
            orderId: order.id,
            gateway: 'credit_direct',
            merchant_slug: merchant.slug || '',
          });
          verificationQuery.set(
            'creditDirectCompletion',
            completionMarker.transactionId,
          );
          if (order.tracking_token) {
            verificationQuery.set('trackingToken', order.tracking_token);
          }
          if (customerEmail) {
            verificationQuery.set('email', customerEmail);
          }
          routerPush(
            getHref(`/checkout/bnpl?${verificationQuery.toString()}`),
          );
        },
        onError: (error) => {
          console.error('Credit Direct error:', error);
          toast({
            title: 'Credit Direct Failed',
            description:
              error || 'Credit Direct checkout failed. Please try again.',
            variant: 'destructive',
          });
          setIsProcessing(false);
          isOrderInFlightRef.current = false;
        },
        onClose: () => {
          setIsProcessing(false);
          isOrderInFlightRef.current = false;
        },
        onPopup: async ({ checkoutTransactionId, sessionId }) => {
          writeCreditDirectPopupMarker(
            order.id,
            checkoutTransactionId || sessionId,
          );
          if (!checkoutTransactionId) {
            return;
          }
          try {
            await persistCreditDirectPopupReference(
              order,
              checkoutTransactionId,
            );
          } catch (error) {
            console.error(
              'Failed to persist Credit Direct popup reference:',
              error instanceof Error ? error.message : error,
            );
          }
        },
      });
      return;
    }

    if (paymentMethod === 'credpal') {
      const credpalKey = process.env.NEXT_PUBLIC_CREDPAL_KEY;
      if (!credpalKey) {
        toast({
          title: 'CredPal Unavailable',
          description:
            'CredPal payment is not available at this time. Please select a different payment method.',
          variant: 'destructive',
        });
        setIsProcessing(false);
        isOrderInFlightRef.current = false;
        return;
      }

      captureClientEvent(
        CHECKOUT_FUNNEL_EVENTS.paymentStarted,
        buildCheckoutFunnelProperties({
          channel: 'web',
          orderId: order.id,
          orderNumber: createdOrderNumber,
          paymentIntent: getCheckoutPaymentIntent(paymentMethod),
          paymentMethod,
          source: 'web_checkout',
          total: paymentAmount,
        })
      );

      await openCredPalCheckout({
        key: credpalKey,
        amount: paymentAmount,
        product: cart.map((item) => item.name).join(', '),
        customerEmail,
        customerName: `${firstName} ${lastName}`.trim(),
        customerPhone,
        onSuccess: (data) => {
          if (data.status === 'success') {
            captureCheckoutFunnelEventOnce(
              CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
              order.id,
              buildCheckoutFunnelProperties({
                channel: 'web',
                orderId: order.id,
                orderNumber: createdOrderNumber,
                paymentIntent: 'installments',
                paymentMethod: 'credpal',
                paymentStatus: 'paid',
                reference: data.order_no,
                source: 'web_checkout',
                total: order.total,
              })
            );
          }
          clearCheckoutSession();
          clearCart();
          routerPush(
            getHref(
              `/order-success?type=credpal&orderId=${order.id}&credpalRef=${data.order_no}${trackingParam}`,
            ),
          );
        },
        onError: (error: { message?: string }) => {
          console.error('CredPal error:', error);
          toast({
            title: 'CredPal Failed',
            description:
              error.message ||
              'CredPal checkout failed. Please try again.',
            variant: 'destructive',
          });
          setIsProcessing(false);
          isOrderInFlightRef.current = false;
        },
        onClose: () => {
          setIsProcessing(false);
          isOrderInFlightRef.current = false;
        },
      });
      return;
    }

    if (paymentMethod === 'invoice') {
      captureCheckoutFunnelEventOnce(
        CHECKOUT_FUNNEL_EVENTS.invoiceGenerated,
        order.id,
        buildCheckoutFunnelProperties({
          channel: 'web',
          itemCount: orderItems.reduce((count, item) => count + item.quantity, 0),
          orderId: order.id,
          orderNumber: createdOrderNumber,
          paymentIntent: 'proforma_invoice',
          paymentMethod: 'invoice',
          paymentStatus: 'unpaid',
          source: 'web_checkout',
          total: order.total,
        })
      );
      clearCheckoutSession();
      routerPush(
        getHref(
          `/order-success?type=invoice&orderId=${order.id}${trackingParam}`,
        ),
      );
      setTimeout(clearCart, 500);
    } else if (paymentMethod === 'payforme') {
      clearCheckoutSession();
      routerPush(
        getHref(
          `/order-success?type=payforme&orderId=${order.id}&payerName=${encodeURIComponent(payForMeDetails.name)}${trackingParam}`,
        ),
      );
      setTimeout(clearCart, 500);
    } else {
      // Default: POD or other
      clearCheckoutSession();
      routerPush(
        getHref(
          `/order-success?type=standard&orderId=${order.id}${trackingParam}`,
        ),
      );
      setTimeout(clearCart, 500);
    }
  } catch (error) {
    if (createdOrderId) {
      captureClientEvent(
        CHECKOUT_FUNNEL_EVENTS.paymentFailed,
        buildCheckoutFunnelProperties({
          channel: 'web',
          orderId: createdOrderId,
          orderNumber: createdOrderNumber,
          paymentIntent: getCheckoutPaymentIntent(paymentMethod),
          paymentMethod,
          reason: error instanceof Error ? error.name : 'checkout_error',
          source: 'web_checkout',
        })
      );
    }
    console.error('Checkout error:', error);
    toast({
      title: 'Checkout Failed',
      description:
        error instanceof Error
          ? error.message
          : 'An error occurred. Please try again.',
      variant: 'destructive',
    });
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    setCurrentStep('payment');
    setCompletedSteps({ contact: true, delivery: true });
  }
}

/** Initialize payment through the server-side payment initialization route. */
async function initializeCardPayment(
  merchantId: string,
  orderId: string,
  currency: string,
  email: string,
  name: string,
  phone: string,
  gateway: string,
  billingAddress: {
    line1: string;
    city: string;
    state?: string;
    country: string;
    zip_code: string;
  },
) {
  const res = await fetch('/api/payments/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchant_id: merchantId,
      order_id: orderId,
      currency,
      customer_email: email,
      customer_name: name,
      customer_phone: phone,
      gateway,
      billing_address: billingAddress,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.error || 'Payment initialization failed');
  }

  const result = await res.json();
  if (!result.success) {
    throw new Error('Payment initialization failed');
  }
  return result;
}
