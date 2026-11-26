import { router } from 'expo-router';
import {
  buildKlumpBnplRouteParams,
  buildKlumpInitializePayload,
} from '@/lib/klump-checkout';
import { OrderError } from '@/services/orders';
import {
  CHECKOUT_API_BASE_URL,
  CHECKOUT_MERCHANT_DOMAIN,
  CHECKOUT_MERCHANT_ID,
  CHECKOUT_MERCHANT_SLUG,
} from './checkout-screen.constants';
import {
  type PaymentInitializeData,
  toPaymentInitializeData,
} from './payment-initialize-data';

const BNPL_PAYMENT_INIT_TIMEOUT_MS = 10_000;

export async function initializeKlumpAndRoute({
  customerEmail,
  customerName,
  customerPhone,
  orderId,
  payableAmount,
  setIsProcessing,
  trackingToken,
}: {
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
  payableAmount: number;
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

  let initData: PaymentInitializeData;
  try {
    initData = toPaymentInitializeData(await initResponse.json());
  } catch {
    throw new OrderError(
      'Failed to initialize Klump payment',
      'PAYMENT_INIT_ERROR'
    );
  }
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
      amount: payableAmount,
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
