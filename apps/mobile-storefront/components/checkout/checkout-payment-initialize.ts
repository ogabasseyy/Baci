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
          currency: 'NGN',
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

  // The provider initialized: record the start now, never speculatively.
  await trackCheckoutPaymentStarted({
    orderId,
    orderNumber,
    paymentMethod: selectedPayment,
    value: orderResponse.amountDueToGateway,
  });
  setIsProcessing(false);
  if (isBankTransfer) {
    router.push({
      pathname: '/bank-transfer',
      params: {
        orderId,
        orderNumber,
        reference: initData.reference,
        amount: String(orderResponse.amountDueToGateway),
        bankName:
          initData.dva?.bank_name || initData.virtual_account?.bank_name || '',
        accountNumber:
          initData.dva?.account_number ||
          initData.virtual_account?.account_number ||
          '',
        accountName:
          initData.dva?.account_name ||
          initData.virtual_account?.account_name ||
          '',
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
      authorizationUrl: initData.authorization_url || initData.checkout_url,
      reference: initData.reference,
      amount: String(orderResponse.amountDueToGateway),
      // Canonical order total for revenue-accurate purchase reporting; the
      // gateway `amount` above is only the residual due after credits.
      orderTotal: String(orderResponse.order.total),
      ...(trackingToken && { trackingToken }),
    },
  });
}
