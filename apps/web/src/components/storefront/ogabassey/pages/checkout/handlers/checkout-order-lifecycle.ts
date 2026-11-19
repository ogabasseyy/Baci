import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
  getCheckoutPaymentIntent,
  resolveFinalizedCheckoutPaymentMethod,
} from '@baci/shared/contracts';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { buildCheckoutBillingAddress } from '../build-checkout-billing-address';
import type { RedvaultQuoteSummary } from '../components/redvault/RedvaultPaymentOption';
import type { PendingCheckoutOrderSnapshot } from '../pending-checkout-order';
import { persistPendingCheckoutOrder } from '../persist-pending-checkout-order';
import { readRedvaultReviewRecovery } from '../read-redvault-review-recovery';
import { clearRedvaultUncertainAttempt } from '../redvault-uncertain-attempt';
import type { PaymentMethod } from '../types';
import { recoverPendingCheckoutOrder } from './recover-pending-checkout-order';
import {
  isRedvaultAttemptFenceCurrent,
  prepareRedvaultRecovery,
  type RedvaultAttemptFence,
} from './prepare-redvault-recovery';
import type {
  CheckoutPaymentOrder,
  CheckoutWalletRedemption,
  SubmitCheckoutOrderOptions,
  SubmittedCheckoutOrder,
} from './submit-checkout-order';
import { submitCheckoutOrder } from './submit-checkout-order';

export type CheckoutOrderReuseOptions = Parameters<
  typeof recoverPendingCheckoutOrder
>[0]['reuse'];
export type CheckoutOrderRecoveryContext = Parameters<
  typeof recoverPendingCheckoutOrder
>[0]['context'];

type SubmitOptions = Omit<SubmitCheckoutOrderOptions, 'resolvedPendingOrder'>;

export interface CheckoutOrderLifecycleOptions {
  reuse: CheckoutOrderReuseOptions;
  recoveryContext: CheckoutOrderRecoveryContext;
  submit: SubmitOptions;
  customer: {
    email: string;
    phone: string;
    merchantId: string;
  };
  fingerprint: string;
  paymentMethod: PaymentMethod;
  itemCount: number;
  shipping: number;
  subtotal: number;
  tax: number;
  fallbackTotal: number;
  currencyFallback: string;
  shippingAddress: { address: string; city: string; state: string };
  merchantCountry: string;
  onRedvaultSummary: (summary: RedvaultQuoteSummary) => void;
  onOrderCreated: (created: {
    orderId: string;
    orderNumber: string;
    currency: string;
  }) => void;
  onPendingSnapshot: (snapshot: PendingCheckoutOrderSnapshot) => void;
  redvaultReview: {
    enabled: boolean;
    customerName: string;
    checkoutFingerprint: string;
    setReady: (ready: {
      cartId?: string;
      billingAddress: ReturnType<typeof buildCheckoutBillingAddress>;
      customerEmail: string;
      customerName: string;
      customerPhone: string;
      currency: string;
      orderId: string;
      checkoutFingerprint: string;
      trackingToken?: string;
      total: number;
      orderNumber: string;
    }) => void;
    releaseSubmission: () => void;
  };
}

export type CheckoutOrderLifecycleResult =
  | { kind: 'handled' }
  | { kind: 'redvault_review' }
  | {
      kind: 'payment_ready';
      order: CheckoutPaymentOrder;
      freshOrder?: true;
      wallet: CheckoutWalletRedemption | null;
      amountDueToGateway: number;
      createdOrderNumber: string;
      orderChargeCurrency: string;
      billingAddress: ReturnType<typeof buildCheckoutBillingAddress>;
    };

/** Resolve an existing attempt, submit at most once, then persist its authoritative order before payment. */
export async function runCheckoutOrderLifecycle({
  reuse,
  recoveryContext,
  submit,
  customer,
  fingerprint,
  paymentMethod,
  itemCount,
  shipping,
  subtotal,
  tax,
  fallbackTotal,
  currencyFallback,
  shippingAddress,
  merchantCountry,
  onRedvaultSummary,
  onOrderCreated,
  onPendingSnapshot,
  redvaultReview,
}: CheckoutOrderLifecycleOptions): Promise<CheckoutOrderLifecycleResult> {
  const recovery = await recoverPendingCheckoutOrder({
    reuse,
    context: recoveryContext,
  });
  if (recovery.kind === 'handled') return { kind: 'handled' };

  let attemptedKey: string | undefined;
  let attemptFence: RedvaultAttemptFence | undefined;
  const submitted: SubmittedCheckoutOrder = await submitCheckoutOrder({
    ...submit,
    resolvedPendingOrder: recovery.pendingOrder,
    onBeforeBoundRedvaultSend: ({ idempotencyKey, orderRequest }) => {
      if (!redvaultReview.enabled) {
        throw new Error(
          'UBA checkout recovery is unavailable. Please try again.'
        );
      }
      attemptFence = prepareRedvaultRecovery({
        merchantSlug: reuse.merchantSlug ?? null,
        merchantId: customer.merchantId,
        idempotencyKey,
        fingerprint: redvaultReview.checkoutFingerprint,
        customer: {
          email: customer.email,
          phone: customer.phone,
          name: redvaultReview.customerName,
        },
        shippingAddress,
        merchantCountry,
        orderRequest,
      });
      attemptedKey = idempotencyKey;
    },
  });
  const { order, wallet } = submitted;
  const amountDueToGateway = submitted.amountDueToGateway;
  if (submitted.redvaultSummary) onRedvaultSummary(submitted.redvaultSummary);

  const createdOrderNumber =
    order.order_number || order.id.slice(0, 8).toUpperCase();
  const orderChargeCurrency =
    typeof order.currency === 'string' && order.currency.trim()
      ? order.currency.trim().toUpperCase()
      : currencyFallback;
  onOrderCreated({
    orderId: order.id,
    orderNumber: createdOrderNumber,
    currency: orderChargeCurrency,
  });

  const finalizedPaymentMethod = resolveFinalizedCheckoutPaymentMethod(
    typeof order.payment_method === 'string' ? order.payment_method : undefined,
    paymentMethod
  );
  try {
    captureCheckoutFunnelEventOnce(
      CHECKOUT_FUNNEL_EVENTS.orderCreated,
      order.id,
      buildCheckoutFunnelProperties({
        channel: 'web',
        currency: orderChargeCurrency,
        itemCount,
        orderId: order.id,
        orderNumber: createdOrderNumber,
        paymentIntent: getCheckoutPaymentIntent(finalizedPaymentMethod),
        paymentMethod: finalizedPaymentMethod,
        paymentStatus: order.payment_status || 'unpaid',
        shipping,
        source: 'web_checkout',
        subtotal,
        tax,
        total: order.total ?? fallbackTotal,
      })
    );
  } catch {
    // Telemetry is best-effort; it must not prevent fencing a created order.
  }

  const billingAddress = buildCheckoutBillingAddress(
    shippingAddress.address,
    shippingAddress.city,
    shippingAddress.state,
    merchantCountry
  );
  const ready = {
    ...(submit.orderRequest.shared_cart
      ? { cartId: submit.orderRequest.shared_cart.cart_id }
      : {}),
    billingAddress,
    customerEmail: customer.email,
    customerName: redvaultReview.customerName,
    customerPhone: customer.phone,
    currency: orderChargeCurrency,
    orderId: order.id,
    checkoutFingerprint: redvaultReview.checkoutFingerprint,
    trackingToken: order.tracking_token,
    total: order.total ?? fallbackTotal,
    orderNumber: createdOrderNumber,
  };
  const snapshot: PendingCheckoutOrderSnapshot = {
    orderId: order.id,
    orderNumber: order.order_number,
    trackingToken: order.tracking_token,
    merchantId: customer.merchantId,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    checkoutFingerprint: fingerprint,
    paymentMethod: reuse.paymentMethod,
    amountDueToGateway,
    createdAt: new Date().toISOString(),
    ...(redvaultReview.enabled &&
    submit.orderRequest.shared_cart &&
    submitted.redvaultSummary
      ? {
          redvaultReview: {
            ready,
            summary: submitted.redvaultSummary,
            ...(attemptFence
              ? {
                  recoveryFence: {
                    merchantSlug: attemptFence.merchantSlug,
                    epoch: attemptFence.epoch,
                  },
                }
              : {}),
          },
        }
      : {}),
  };
  if (
    attemptedKey &&
    (!attemptFence ||
      !isRedvaultAttemptFenceCurrent(attemptFence) ||
      !readRedvaultReviewRecovery(snapshot, customer.merchantId))
  ) {
    throw new Error(
      'Unable to restore the UBA checkout review. Please try again.'
    );
  }
  persistPendingCheckoutOrder(snapshot);
  onPendingSnapshot(snapshot);
  if (attemptedKey) {
    try {
      clearRedvaultUncertainAttempt(customer.merchantId, attemptedKey);
    } catch {
      // The durable pending-order fence takes precedence over a stale marker.
    }
  }

  if (redvaultReview.enabled) {
    redvaultReview.setReady(ready);
    redvaultReview.releaseSubmission();
    return { kind: 'redvault_review' };
  }

  return {
    kind: 'payment_ready',
    order,
    ...(submitted.freshOrder ? { freshOrder: true as const } : {}),
    wallet,
    amountDueToGateway,
    createdOrderNumber,
    orderChargeCurrency,
    billingAddress,
  };
}
