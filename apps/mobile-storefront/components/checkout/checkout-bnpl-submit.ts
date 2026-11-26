import { router } from 'expo-router';
import type { MutableRefObject } from 'react';
import { Alert } from 'react-native';
import { toMoneyRouteParam } from '@/components/bnpl-checkout/bnpl-params.schema';
import type { PaymentMethodType } from '@/components/checkout/PaymentMethodSelector';
import type {
  DeliveryMethod,
  ShippingQuote,
} from '@/components/checkout/types';
import type { MobileCheckoutIdempotencyState } from '@/lib/checkout-order-idempotency';
import { getKlumpDisabledReason } from '@/lib/klump-checkout';
import type { ShippingAddressInput } from '@/lib/validation';
import type {
  SavingsSelection,
  WalletSelection,
} from '@/lib/wallet-payment-helpers';
import type { CartCheckoutBinding } from '@/schemas/cart-checkout-binding';
import { createOrder, OrderError } from '@/services/orders';
import type { CreateOrderResult } from '@/services/orders.response';
import type { CartItem } from '@/stores/cart-store';
import type { CheckoutSnapshot } from './checkout-order-builders';
import {
  CHECKOUT_MERCHANT_DOMAIN,
  CHECKOUT_MERCHANT_SLUG,
} from './checkout-screen.constants';
import {
  buildCheckoutSubmitOrderRequest,
  resolveEffectiveSavingsSelection,
} from './checkout-submit-order-request';
import { initializeKlumpAndRoute } from './initialize-klump-and-route';

interface SubmitBnplCheckoutParams {
  address: ShippingAddressInput;
  appliedDiscountCode?: string | null;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  deliveryMethod: DeliveryMethod;
  getShippingProvider: () => string | undefined;
  isOrderInFlight: MutableRefObject<boolean>;
  itemsSnapshot: CartItem[];
  liveSavingsSelection: SavingsSelection | undefined;
  liveWalletSelection: WalletSelection | undefined;
  checkoutGeneration: string;
  mobileCheckoutIdempotencyRef: MutableRefObject<MobileCheckoutIdempotencyState | null>;
  /** Called with the committed order id right after createOrder, so the
   * outer submit can thread it into failure handling when a nested
   * provider init (e.g. Klump) throws after the order exists. */
  onOrderCreated?: (orderId: string) => void;
  paymentMethodForOrder: string;
  paymentSettings: Parameters<typeof getKlumpDisabledReason>[0];
  selectedPayment: PaymentMethodType;
  selectedQuote: ShippingQuote | undefined;
  setIsProcessing: (value: boolean) => void;
  snapshot: CheckoutSnapshot;
  sharedCartBinding?: CartCheckoutBinding;
}

export interface SubmitBnplCheckoutResult {
  creditFields: Record<string, unknown>;
  fallbackOrderResponse: CreateOrderResult;
}

export async function submitBnplCheckout({
  address,
  appliedDiscountCode,
  customerEmail,
  customerName,
  customerPhone,
  deliveryMethod,
  getShippingProvider,
  isOrderInFlight,
  itemsSnapshot,
  liveSavingsSelection,
  liveWalletSelection,
  checkoutGeneration,
  onOrderCreated,
  paymentMethodForOrder,
  paymentSettings,
  selectedPayment,
  selectedQuote,
  setIsProcessing,
  snapshot,
  sharedCartBinding,
}: SubmitBnplCheckoutParams) {
  const effectiveSavingsSelection = resolveEffectiveSavingsSelection(
    liveSavingsSelection,
    appliedDiscountCode
  );
  const netPayableAmount = Math.max(
    snapshot.total -
      (liveWalletSelection?.amount ?? 0) -
      (effectiveSavingsSelection?.amount ?? 0),
    0
  );
  if (netPayableAmount <= 0) {
    Alert.alert(
      'Financing unavailable',
      'No payable balance remains after applying store credit.',
      [{ text: 'OK' }]
    );
    isOrderInFlight.current = false;
    setIsProcessing(false);
    return;
  }

  const klumpSubmitDisabledReason =
    selectedPayment === 'klump'
      ? getKlumpDisabledReason(
          paymentSettings,
          netPayableAmount,
          liveWalletSelection,
          effectiveSavingsSelection
        )
      : undefined;

  if (klumpSubmitDisabledReason) {
    Alert.alert('Klump unavailable', klumpSubmitDisabledReason, [
      { text: 'OK' },
    ]);
    isOrderInFlight.current = false;
    setIsProcessing(false);
    return;
  }

  const { creditFields, orderRequest } = buildCheckoutSubmitOrderRequest({
    address,
    appliedDiscountCode,
    customerEmail,
    customerName,
    customerPhone,
    deliveryMethod,
    itemsSnapshot,
    liveSavingsSelection,
    liveWalletSelection,
    paymentMethodForOrder,
    selectedQuote,
    shippingProvider: getShippingProvider(),
    snapshot,
    sharedCartBinding,
  });
  // The order service owns durable retry identity across payment methods.
  // Never rotate it when a completed order rejects reuse.
  const orderResponse = await createOrder(orderRequest, {
    analyticsPaymentMethod: selectedPayment,
    checkoutGeneration,
  });
  onOrderCreated?.(orderResponse.order.id);

  if (orderResponse.amountDueToGateway <= 0) {
    const normalizedPaymentStatus =
      orderResponse.order.payment_status?.trim().toLowerCase() ?? '';
    if (
      normalizedPaymentStatus !== 'paid' &&
      normalizedPaymentStatus !== 'bnpl_approved'
    ) {
      isOrderInFlight.current = false;
      setIsProcessing(false);
      throw new OrderError(
        'Your store credit could not complete this order. Please try again.',
        'STORE_CREDIT_NOT_SETTLED'
      );
    }
    const normalizedOrderResponse =
      normalizedPaymentStatus === orderResponse.order.payment_status
        ? orderResponse
        : {
            ...orderResponse,
            order: {
              ...orderResponse.order,
              payment_status: normalizedPaymentStatus,
            },
          };
    return {
      creditFields,
      fallbackOrderResponse: normalizedOrderResponse,
    };
  }

  if (selectedPayment === 'klump') {
    await initializeKlumpAndRoute({
      customerEmail,
      customerName,
      customerPhone,
      orderId: orderResponse.order.id,
      payableAmount: Number(orderResponse.amountDueToGateway),
      setIsProcessing,
      trackingToken: orderResponse.order.tracking_token,
    });
    // No start here: initialize only provides the Klump launcher URL — the
    // provider UI has not opened. The launcher bridges Klump's onOpen over
    // the WebView bridge and the checkout controller records the start
    // then, like the other BNPL providers.
    isOrderInFlight.current = false;
    return;
  }

  // No start here: the provider is initialized later inside the BNPL
  // checkout launcher, where lookup, SDK loading, or popup creation can
  // still fail. The launcher confirms the opened flow back over the
  // WebView bridge and the checkout controller records the start then
  // (the Klump branch above follows the same bridge via onOpen).

  isOrderInFlight.current = false;
  setIsProcessing(false);
  // The provider charges the residual (`amount`), but completion revenue
  // is the canonical order total: route it separately for attribution.
  const canonicalOrderTotal = Number(orderResponse.order.total);
  router.push({
    pathname: '/bnpl-checkout',
    params: {
      orderId: orderResponse.order.id,
      gateway: selectedPayment,
      amount: toMoneyRouteParam(orderResponse.amountDueToGateway),
      ...(Number.isFinite(canonicalOrderTotal)
        ? { orderTotal: toMoneyRouteParam(canonicalOrderTotal) }
        : {}),
      customerEmail,
      customerName,
      customerPhone,
      merchantSlug: CHECKOUT_MERCHANT_SLUG,
      ...(CHECKOUT_MERCHANT_DOMAIN && {
        merchantDomain: CHECKOUT_MERCHANT_DOMAIN,
      }),
      ...(orderResponse.order.tracking_token && {
        trackingToken: orderResponse.order.tracking_token,
      }),
      // Breakdown snapshot for the approved completion's durable claim
      // (see use-bnpl-checkout-controller): identity already travels above.
      subtotal: toMoneyRouteParam(snapshot.subtotal),
      shipping: toMoneyRouteParam(snapshot.deliveryFee),
      tax: toMoneyRouteParam(snapshot.taxAmount),
    },
  });
}
