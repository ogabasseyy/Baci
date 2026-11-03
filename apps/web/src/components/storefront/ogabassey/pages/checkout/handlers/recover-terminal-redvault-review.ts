import { toast } from '@/hooks/use-toast';
import { cancelStaleCheckoutOrder } from '../cancel-stale-checkout-order';
import type { RedvaultQuoteSummary } from '../components/redvault/RedvaultPaymentOption';
import type { CheckoutOrderSubmissionContext } from '../hooks/checkout-order-submission-types';
import { isTerminalRedvaultReview } from '../is-terminal-redvault-review';
import type { PendingCheckoutOrderSnapshot } from '../pending-checkout-order';
import { readRedvaultReviewRecovery } from '../read-redvault-review-recovery';
import { redvaultTerminalFingerprintMatches } from '../redvault-terminal-fingerprint';
import type { PaymentMethod } from '../types';
import type { RedvaultPreparedOrder } from './redvault-prepared-order-submit';

interface TerminalRedvaultRecoveryOptions {
  merchantId: string;
  merchantSlug?: string | null;
  pendingOrder: PendingCheckoutOrderSnapshot | null;
  paymentMethod: PaymentMethod;
  checkoutFingerprint: string;
  sharedCartEnabled: boolean;
  sharedCartRef: { cartId: string; version: number } | null;
  checkoutCartEmpty: boolean;
  waitForResolvedCustomerAuth: () => Promise<boolean>;
  setIsProcessing: (value: boolean) => void;
  setReady: (value: RedvaultPreparedOrder | null) => void;
  setSummary: (value: RedvaultQuoteSummary | null) => void;
  clearPending: () => void;
  releaseSubmission: () => void;
}

/** Release a changed reviewed draft before the shopper starts a new cart. */
export async function recoverTerminalRedvaultReview(
  options: TerminalRedvaultRecoveryOptions
): Promise<boolean> {
  if (
    !isTerminalRedvaultReview({
      merchantId: options.merchantId,
      pendingOrder: options.pendingOrder,
      sharedCartEnabled: options.sharedCartEnabled,
      sharedCartRef: options.sharedCartRef,
      checkoutItemCount: options.checkoutCartEmpty ? 0 : 1,
    })
  )
    return false;

  const review = readRedvaultReviewRecovery(
    options.pendingOrder,
    options.merchantId
  );
  if (!review) return false;
  if (
    options.paymentMethod === 'uba_redvault' &&
    redvaultTerminalFingerprintMatches(
      review.ready.checkoutFingerprint,
      options.checkoutFingerprint
    )
  )
    return false;

  options.setIsProcessing(true);
  let verdict: Awaited<ReturnType<typeof cancelStaleCheckoutOrder>> = 'failed';
  try {
    verdict = await cancelStaleCheckoutOrder({
      isAuthenticated: await options.waitForResolvedCustomerAuth(),
      orderId: review.ready.orderId,
      reason: 'Checkout details changed before UBA payment',
      trackingToken: review.ready.trackingToken,
      requireNewCancellation: true,
      merchantId: options.merchantId,
      merchantSlug: options.merchantSlug,
    });
  } catch {
    // An unresolved auth lookup cannot prove that the old order is safe to release.
  }
  // A 404 may reflect an account switch: an attached guest order can
  // be invisible to both the new account and the guest cancellation
  // route while remaining payable. Only a confirmed cancellation
  // releases the local fence and permits a new checkout.
  if (verdict === 'cancelled') {
    // Do not clear the shared browser idempotency slot here: another
    // tab may already be using it for its own checkout attempt.
    options.clearPending();
    options.setReady(null);
    options.setSummary(null);
    toast({
      title: 'Checkout review cancelled',
      description:
        'Please add your items to your cart again to continue with the updated details.',
    });
  } else {
    toast({
      title: 'Order still processing',
      description:
        verdict === 'live'
          ? 'Your previous UBA payment is still being processed. Please wait before starting another checkout.'
          : 'We could not release your previous order. Please try again.',
      variant: 'destructive',
    });
  }
  options.releaseSubmission();
  return true;
}

export function recoverTerminalRedvaultReviewForContext(
  context: CheckoutOrderSubmissionContext,
  merchantId: string,
  checkoutFingerprint: string
) {
  const { account, cart, order, payment, processing } = context;
  return recoverTerminalRedvaultReview({
    merchantId,
    merchantSlug: context.merchant?.slug,
    pendingOrder: order.pending,
    paymentMethod: payment.session.method,
    checkoutFingerprint,
    sharedCartEnabled: cart.sharedCartEnabled === true,
    sharedCartRef: cart.sharedCartRef ?? null,
    checkoutCartEmpty: cart.checkoutCart.length === 0,
    waitForResolvedCustomerAuth: account.waitForResolvedCustomerAuth,
    setIsProcessing: processing.setIsProcessing,
    setReady: payment.session.redvault.setOrderReady,
    setSummary: payment.session.redvault.setSummary,
    clearPending: order.clearPending,
    releaseSubmission: processing.releaseSubmission,
  });
}
