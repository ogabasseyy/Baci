import { router } from 'expo-router';
import { RedvaultCheckoutSchema } from '@/schemas/redvault-checkout';
import { getCheckoutAuthorizationHeaders } from '@/services/redvault';
import {
  CHECKOUT_API_BASE_URL,
  CHECKOUT_MERCHANT_ID,
} from '../checkout-screen.constants';
import type { RedvaultReviewInput } from './RedvaultOrderReview';

export class RedvaultInitializationError extends Error {
  constructor(readonly kind: 'definitive' | 'indeterminate') {
    super('Unable to initialize UBA payment');
  }
}

export async function initializeRedvaultCheckout(
  input: RedvaultReviewInput,
  isActive: () => boolean = () => true
) {
  const checkout = RedvaultCheckoutSchema.parse(input.orderResponse);
  const headers = await getCheckoutAuthorizationHeaders();
  if (!isActive()) return 'pending' as const;
  const response = await fetch(
    `${CHECKOUT_API_BASE_URL}/api/payments/initialize`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        merchant_id: CHECKOUT_MERCHANT_ID,
        order_id: checkout.order.id,
        customer_email: input.customerEmail,
        customer_name: input.customerName,
        customer_phone: input.customerPhone,
        payment_method: 'uba_redvault',
        gateway: 'paystack',
      }),
    }
  );
  if (!isActive()) return 'pending' as const;
  if (response.status === 202) return 'pending' as const;
  if (!response.ok) {
    throw new RedvaultInitializationError(
      response.status >= 400 && response.status < 500
        ? 'definitive'
        : 'indeterminate'
    );
  }
  const body: unknown = await response.json();
  if (
    !response.ok ||
    !body ||
    typeof body !== 'object' ||
    !('success' in body) ||
    body.success !== true ||
    !('authorization_url' in body) ||
    typeof body.authorization_url !== 'string' ||
    !('reference' in body) ||
    typeof body.reference !== 'string' ||
    !body.reference
  ) {
    throw new RedvaultInitializationError('indeterminate');
  }
  const url = new URL(body.authorization_url);
  if (url.protocol !== 'https:') {
    throw new RedvaultInitializationError('indeterminate');
  }
  if (!isActive()) return 'pending' as const;
  router.push({
    pathname: '/payment-gateway',
    params: {
      orderId: checkout.order.id,
      gateway: 'paystack',
      paymentMethod: 'uba_redvault',
      authorizationUrl: body.authorization_url,
      reference: body.reference,
      amount: String(checkout.order.total),
      ...(checkout.order.tracking_token
        ? { trackingToken: checkout.order.tracking_token }
        : {}),
    },
  });
  return 'ready' as const;
}
