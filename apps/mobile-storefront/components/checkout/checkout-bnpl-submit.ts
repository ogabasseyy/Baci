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
import { createOrder } from '@/services/orders';
import type { CartItem } from '@/stores/cart-store';
import {
  buildCheckoutOrderRequest,
  type CheckoutSnapshot,
} from './checkout-order-builders';
import {
  CHECKOUT_MERCHANT_DOMAIN,
  CHECKOUT_MERCHANT_SLUG,
} from './checkout-screen.constants';

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
  /** Exposes the committed order ID to outer checkout failure handling. */
  onOrderCreated?: (orderId: string) => void;
  paymentMethodForOrder: string;
  paymentSettings: Parameters<typeof getKlumpDisabledReason>[0];
  selectedPayment: PaymentMethodType;
  selectedQuote: ShippingQuote | undefined;
  setIsProcessing: (value: boolean) => void;
  snapshot: CheckoutSnapshot;
  sharedCartBinding?: CartCheckoutBinding;
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
  if (selectedPayment === 'klump') {
    const klumpSubmitDisabledReason = getKlumpDisabledReason(
      paymentSettings,
      snapshot.total,
      liveWalletSelection,
      liveSavingsSelection
    );
    Alert.alert('Klump unavailable', klumpSubmitDisabledReason, [
      { text: 'OK' },
    ]);
    isOrderInFlight.current = false;
    setIsProcessing(false);
    return;
  }

  const orderRequest = buildCheckoutOrderRequest({
    address,
    customerEmail,
    customerName,
    customerPhone,
    deliveryMethod,
    discountCode: appliedDiscountCode,
    itemsSnapshot,
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

  // No start here: the provider is initialized later inside the BNPL
  // checkout launcher, where lookup, SDK loading, or popup creation can
  // still fail. The launcher confirms the opened flow back over the
  // WebView bridge and the checkout controller records the start then.

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
