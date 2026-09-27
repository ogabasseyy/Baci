import { router } from 'expo-router';
import type { PaymentMethodType } from '@/components/checkout/PaymentMethodSelector';
import { trackCheckoutPaymentStarted } from '@/services/analytics';
import { OrderError, type OrderResponse } from '@/services/orders';
import {
  CHECKOUT_API_BASE_URL,
  CHECKOUT_MERCHANT_ID,
} from './checkout-screen.constants';
import {
  type PaymentInitializeData,
  toPaymentInitializeData,
} from './payment-initialize-data';

const PAYMENT_INIT_TIMEOUT_MS = 10_000;

function trimmedOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface InitializeGatewayAndRouteParams {
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
  orderNumber: string;
  orderResponse: OrderResponse;
  selectedPayment: PaymentMethodType;
  setIsProcessing: (value: boolean) => void;
  trackingToken?: string | null;
}

// Initializes the provider (card gateways and legacy DVA bank transfer)
// and routes to the payment surface. payment_started is recorded only once
// the provider initializes — never speculatively before this runs.
export async function initializeGatewayAndRoute({
  customerEmail,
  customerName,
  customerPhone,
  orderId,
  orderNumber,
  orderResponse,
  selectedPayment,
  setIsProcessing,
  trackingToken,
}: InitializeGatewayAndRouteParams): Promise<void> {
  const isBankTransfer = selectedPayment === 'bank_transfer';
  const gateway = isBankTransfer ? 'paystack' : selectedPayment;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAYMENT_INIT_TIMEOUT_MS);
  let initResponse: Response;
  try {
    initResponse = await fetch(
      `${CHECKOUT_API_BASE_URL}/api/payments/initialize`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `payment-init-${orderId}-${gateway}`,
        },
        body: JSON.stringify({
          merchant_id: CHECKOUT_MERCHANT_ID,
          order_id: orderId,
          // Stamped creation currency: the initialize API compares an
          // explicitly supplied currency with the order snapshot, so the
          // old hardcoded default broke non-NGN checkouts with
          // CURRENCY_MISMATCH. Absent values keep the NGN default.
          currency: orderResponse.order.currency || 'NGN',
          customer_email: customerEmail,
          customer_name: customerName,
          customer_phone: customerPhone,
          gateway,
          billing_address: { country: 'NG' },
          ...(isBankTransfer && { payment_type: 'dva' }),
        }),
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

  let initData: PaymentInitializeData;
  try {
    initData = toPaymentInitializeData(await initResponse.json());
  } catch (error) {
    throw new OrderError(
      'Failed to parse payment initialization response',
      'PAYMENT_INIT_ERROR',
      error
    );
  }
  if (!initResponse.ok || !initData.success) {
    throw new OrderError(
      initData.error || 'Failed to initialize payment',
      'PAYMENT_INIT_ERROR'
    );
  }

  // A version-skewed `{ success: true }` envelope can arrive without the
  // fields the destination schemas require (reference, authorization URL,
  // or a complete DVA account). The route would reject those params, so no
  // provider flow actually opened: validate before emitting the start.
  const reference = trimmedOrEmpty(initData.reference);
  if (!reference) {
    throw new OrderError(
      'Payment initialization response is missing the payment reference',
      'PAYMENT_INIT_ERROR'
    );
  }
  const bankName =
    trimmedOrEmpty(initData.dva?.bank_name) ||
    trimmedOrEmpty(initData.virtual_account?.bank_name);
  const accountNumber =
    trimmedOrEmpty(initData.dva?.account_number) ||
    trimmedOrEmpty(initData.virtual_account?.account_number);
  const accountName =
    trimmedOrEmpty(initData.dva?.account_name) ||
    trimmedOrEmpty(initData.virtual_account?.account_name);
  const authorizationUrl =
    trimmedOrEmpty(initData.authorization_url) ||
    trimmedOrEmpty(initData.checkout_url);
  if (isBankTransfer) {
    if (!bankName || !accountNumber || !accountName) {
      throw new OrderError(
        'Payment initialization response is missing the virtual account details',
        'PAYMENT_INIT_ERROR'
      );
    }
  } else if (!authorizationUrl) {
    throw new OrderError(
      'Payment initialization response is missing the authorization URL',
      'PAYMENT_INIT_ERROR'
    );
  }

  // The provider initialized: record the start now, never speculatively.
  // Stamped with the issued reference so retried attempts for one order
  // reconcile at attempt level instead of producing identical starts.
  await trackCheckoutPaymentStarted({
    orderId,
    orderNumber,
    paymentMethod: selectedPayment,
    reference,
    // Revenue is the canonical order total, not the residual due at the
    // gateway after wallet/savings credit — matching order_created and
    // the eventual completion. amountDueToGateway stays on the route
    // params above, which is what the provider actually charges.
    value: orderResponse.order.total,
    // Stamped creation currency: absent values keep the NGN default.
    ...(orderResponse.order.currency
      ? { currency: orderResponse.order.currency }
      : {}),
  });
  setIsProcessing(false);
  if (isBankTransfer) {
    router.push({
      pathname: '/bank-transfer',
      params: {
        orderId,
        orderNumber,
        reference,
        amount: String(orderResponse.amountDueToGateway),
        bankName,
        accountNumber,
        accountName,
        ...(trackingToken && { trackingToken }),
      },
    });
    return;
  }

  router.push({
    pathname: '/payment-gateway',
    params: {
      orderId,
      orderNumber,
      gateway: selectedPayment,
      authorizationUrl,
      reference,
      amount: String(orderResponse.amountDueToGateway),
      // Canonical order total for revenue-accurate purchase reporting; the
      // gateway `amount` above is only the residual due after credits.
      orderTotal: String(orderResponse.order.total),
      ...(trackingToken && { trackingToken }),
    },
  });
}
