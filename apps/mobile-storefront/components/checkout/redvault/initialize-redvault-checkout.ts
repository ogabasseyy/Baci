import { router } from 'expo-router';
import { RedvaultCheckoutSchema } from '@/schemas/redvault-checkout';
import { trackCheckoutPaymentStarted } from '@/services/analytics';
import { getCheckoutAuthorizationHeaders } from '@/services/redvault';
import {
  CHECKOUT_API_BASE_URL,
  CHECKOUT_MERCHANT_ID,
} from '../checkout-screen.constants';
import type { RedvaultReviewInput } from './RedvaultOrderReview';
import { RedvaultInitializationError } from './redvault-initialization-error';

export { RedvaultInitializationError };

export type InitializeRedvaultCheckoutByIdInput = {
  orderId: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  amount?: string;
  trackingToken?: string;
  isActive?: () => boolean;
  /**
   * Account-sync side effects (guest signup + application attach). Runs
   * after the hosted checkout is confirmed but before gateway navigation:
   * a signup that establishes a persistent session must be attached to the
   * order before the app can be killed on the gateway screen, or the
   * guest-owned attempt can never replay or verify under the new session.
   */
  onReady?: () => Promise<void>;
};

/**
 * Initializes (or replays) a REDVAULT hosted checkout for a known order id
 * without a review payload. Used when resubmission discovers a live fenced
 * order: server-side init replays the existing authorization URL instead of
 * opening a second checkout.
 */
export async function initializeRedvaultCheckoutById({
  orderId,
  customerEmail,
  customerName,
  customerPhone,
  amount,
  trackingToken,
  isActive = () => true,
  onReady,
}: InitializeRedvaultCheckoutByIdInput) {
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
        order_id: orderId,
        customer_email: customerEmail,
        customer_name: customerName,
        customer_phone: customerPhone,
        payment_method: 'uba_redvault',
        gateway: 'paystack',
        // Order-bound proof the guest lane requires; a missing token
        // fails closed server-side as a definitive rejection.
        ...(trackingToken ? { tracking_token: trackingToken } : {}),
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
  // The provider reference is confirmed: open the funnel attempt now.
  // The REDVAULT review path bypasses finalizeCheckoutPayment, so
  // without this the later provider-verified payment_completed (and any
  // cancellation/load-error event) would have no matching start.
  const startedValue = amount !== undefined ? Number(amount) : Number.NaN;
  await trackCheckoutPaymentStarted({
    orderId,
    paymentMethod: 'uba_redvault',
    reference: body.reference,
    ...(Number.isFinite(startedValue) ? { value: startedValue } : {}),
  });
  if (onReady) {
    await onReady();
  }
  router.push({
    pathname: '/payment-gateway',
    params: {
      orderId,
      gateway: 'paystack',
      paymentMethod: 'uba_redvault',
      authorizationUrl: body.authorization_url,
      reference: body.reference,
      ...(amount !== undefined ? { amount } : {}),
      ...(trackingToken ? { trackingToken } : {}),
    },
  });
  return 'ready' as const;
}

export async function initializeRedvaultCheckout(
  input: RedvaultReviewInput,
  isActive: () => boolean = () => true
) {
  const checkout = RedvaultCheckoutSchema.parse(input.orderResponse);
  return await initializeRedvaultCheckoutById({
    orderId: checkout.order.id,
    customerEmail: input.customerEmail,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    amount: String(checkout.order.total),
    trackingToken: checkout.order.tracking_token ?? undefined,
    isActive,
    ...(input.onInitializationSuccess
      ? {
          onReady: async () => {
            await input.onInitializationSuccess?.();
          },
        }
      : {}),
  });
}
