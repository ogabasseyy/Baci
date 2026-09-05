import { router } from 'expo-router';
import type { MutableRefObject } from 'react';
import { Alert } from 'react-native';
import type { PaymentMethodType } from '@/components/checkout/PaymentMethodSelector';
import type {
  DeliveryMethod,
  ShippingQuote,
} from '@/components/checkout/types';
import type { MobileCheckoutIdempotencyState } from '@/lib/checkout-order-idempotency';
import {
  buildKlumpBnplRouteParams,
  buildKlumpInitializePayload,
  getKlumpDisabledReason,
} from '@/lib/klump-checkout';
import type { ShippingAddressInput } from '@/lib/validation';
import type {
  SavingsSelection,
  WalletSelection,
} from '@/lib/wallet-payment-helpers';
import { createOrder, OrderError } from '@/services/orders';
import type { CartItem } from '@/stores/cart-store';
import {
  buildCheckoutOrderRequest,
  type CheckoutSnapshot,
} from './checkout-order-builders';
import {
  CHECKOUT_API_BASE_URL,
  CHECKOUT_MERCHANT_DOMAIN,
  CHECKOUT_MERCHANT_ID,
  CHECKOUT_MERCHANT_SLUG,
} from './checkout-screen.constants';

const BNPL_PAYMENT_INIT_TIMEOUT_MS = 10_000;

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
  mobileCheckoutIdempotencyRef: MutableRefObject<MobileCheckoutIdempotencyState | null>;
  paymentMethodForOrder: string;
  paymentSettings: Parameters<typeof getKlumpDisabledReason>[0];
  selectedPayment: PaymentMethodType;
  selectedQuote: ShippingQuote | undefined;
  setIsProcessing: (value: boolean) => void;
  snapshot: CheckoutSnapshot;
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
  paymentMethodForOrder,
  paymentSettings,
  selectedPayment,
  selectedQuote,
  setIsProcessing,
  snapshot,
}: SubmitBnplCheckoutParams) {
  const klumpSubmitDisabledReason =
    selectedPayment === 'klump'
      ? getKlumpDisabledReason(
          paymentSettings,
          snapshot.total,
          liveWalletSelection,
          liveSavingsSelection
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
  });
  // The order service owns durable retry identity across payment methods.
  // Never rotate it when a completed order rejects reuse.
  const orderResponse = await createOrder(orderRequest);

  if (selectedPayment === 'klump') {
    await initializeKlumpAndRoute({
      customerEmail,
      customerName,
      customerPhone,
      orderId: orderResponse.order.id,
      orderTotal: Number(orderResponse.order.total),
      setIsProcessing,
      trackingToken: orderResponse.order.tracking_token,
    });
    isOrderInFlight.current = false;
    return;
  }

  isOrderInFlight.current = false;
  setIsProcessing(false);
  router.push({
    pathname: '/bnpl-checkout',
    params: {
      orderId: orderResponse.order.id,
      gateway: selectedPayment,
      amount: String(orderResponse.amountDueToGateway),
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
    },
  });
}

async function initializeKlumpAndRoute({
  customerEmail,
  customerName,
  customerPhone,
  orderId,
  orderTotal,
  setIsProcessing,
  trackingToken,
}: {
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
  orderTotal: number;
  setIsProcessing: (value: boolean) => void;
  trackingToken?: string | null;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    BNPL_PAYMENT_INIT_TIMEOUT_MS
  );
  let initResponse: Response;
  try {
    initResponse = await fetch(
      `${CHECKOUT_API_BASE_URL}/api/payments/initialize`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `payment-init-${orderId}-klump`,
        },
        body: JSON.stringify(
          buildKlumpInitializePayload({
            customerEmail,
            customerName,
            customerPhone,
            merchantId: CHECKOUT_MERCHANT_ID,
            orderId,
          })
        ),
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new OrderError(
        'Payment initialization timed out',
        'PAYMENT_INIT_TIMEOUT'
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const initData = await initResponse.json();
  if (
    !initResponse.ok ||
    !initData.success ||
    typeof initData.authorization_url !== 'string' ||
    typeof initData.reference !== 'string'
  ) {
    throw new OrderError(
      initData.error || 'Failed to initialize Klump payment',
      'PAYMENT_INIT_ERROR'
    );
  }

  setIsProcessing(false);
  router.push({
    pathname: '/bnpl-checkout',
    params: buildKlumpBnplRouteParams({
      amount: orderTotal,
      authorizationUrl: initData.authorization_url,
      customerEmail,
      customerName,
      customerPhone,
      orderId,
      reference: initData.reference,
      merchantSlug: CHECKOUT_MERCHANT_SLUG,
      ...(CHECKOUT_MERCHANT_DOMAIN && {
        merchantDomain: CHECKOUT_MERCHANT_DOMAIN,
      }),
      trackingToken,
    }),
  });
}
