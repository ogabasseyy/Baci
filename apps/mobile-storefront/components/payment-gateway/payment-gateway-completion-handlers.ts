import type { QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import {
  claimCheckoutPurchaseTracking,
  isCheckoutPurchaseClaimed,
} from '@/lib/claim-checkout-purchase-tracking';
import { clearPersistedRedvaultOrderWithRetry } from '@/lib/pending-redvault-order';
import {
  clearRedvaultPurchaseTrackingContext,
  loadRedvaultPurchaseTrackingContext,
} from '@/lib/redvault-purchase-tracking-context';
import type { PaymentGatewayParams } from '@/schemas/payment-gateway';
import { trackCheckoutPaymentCompletedOnce } from '@/services/analytics';
import { verifyRedvaultPayment } from '@/services/redvault';
import { trackCheckoutRoutePurchaseCompleted } from '@/services/tiktok-checkout-route-tracking';
import { PAYMENT_KINDS } from './payment-gateway.helpers';
import {
  beginSavingsAuthorizationCompletion,
  beginWalletTopUpCompletion,
} from './payment-gateway-completions';
import type {
  PaymentGatewayRefs,
  PaymentStatusSetter,
} from './payment-gateway-controller.types';
import { handleVtuConfirmation } from './use-vtu-payment-completion';
import { verifyOrderPaymentForCompletion } from './verify-order-payment';

interface PaymentGatewayCompletionHandlerInput
  extends Partial<PaymentGatewayParams> {
  clearCart: () => void | Promise<void>;
  clearPendingLoadTimeout: () => void;
  queryClient: QueryClient;
  refs: PaymentGatewayRefs;
  scheduleDelayedNavigation: (navigate: () => void) => void;
  setErrorMessage: (message: string | null) => void;
  setPaymentStatus: PaymentStatusSetter;
}

export function createPaymentGatewayCompletionHandlers({
  amount,
  clearCart,
  clearPendingLoadTimeout,
  customerIdentifier,
  gateway,
  merchantId,
  merchantSlug,
  orderId,
  orderNumber,
  orderTotal,
  paymentKind,
  paymentMethod,
  queryClient,
  reference,
  refs,
  returnTo,
  scheduleDelayedNavigation,
  setErrorMessage,
  setPaymentStatus,
  trackingToken,
  utilityType,
}: PaymentGatewayCompletionHandlerInput) {
  const {
    isMountedRef,
    paymentCompletionStartedRef,
    statusRef,
    vtuConfirmationTokenRef,
  } = refs;

  const isCurrentVtuConfirmation = (confirmationToken: number) =>
    isMountedRef.current &&
    vtuConfirmationTokenRef.current === confirmationToken;

  const beginVtuPaymentCompletion = (input?: {
    amount?: number;
    customerIdentifier?: string;
    reference?: string;
  }) => {
    const currentStatus = statusRef.current;
    if (
      paymentCompletionStartedRef.current ||
      currentStatus === 'processing' ||
      currentStatus === 'success'
    ) {
      return;
    }

    paymentCompletionStartedRef.current = true;
    clearPendingLoadTimeout();
    setPaymentStatus('processing');
    void handleVtuConfirmation({
      amount,
      customerIdentifier,
      fallbackAmount: input?.amount,
      fallbackCustomerIdentifier: input?.customerIdentifier,
      gateway,
      isMountedRef,
      isCurrentVtuConfirmation,
      nextReference: input?.reference ?? reference,
      scheduleDelayedNavigation,
      setErrorMessage,
      setStatus: setPaymentStatus,
      utilityType,
      vtuConfirmationTokenRef,
    });
  };

  const beginPaymentCompletion = async () => {
    const currentStatus = statusRef.current;
    if (
      paymentCompletionStartedRef.current ||
      currentStatus === 'processing' ||
      currentStatus === 'success'
    ) {
      return;
    }

    if (paymentKind === PAYMENT_KINDS.VTU) {
      beginVtuPaymentCompletion();
      return;
    }

    if (paymentKind === PAYMENT_KINDS.WALLET) {
      beginWalletTopUpCompletion({
        clearPendingLoadTimeout,
        gateway,
        merchantId,
        merchantSlug,
        queryClient,
        reference,
        refs,
        returnTo,
        scheduleDelayedNavigation,
        setErrorMessage,
        setPaymentStatus,
      });
      return;
    }

    if (paymentKind === PAYMENT_KINDS.SAVINGS_AUTH) {
      beginSavingsAuthorizationCompletion({
        clearPendingLoadTimeout,
        gateway,
        merchantId,
        merchantSlug,
        queryClient,
        reference,
        refs,
        returnTo,
        scheduleDelayedNavigation,
        setErrorMessage,
        setPaymentStatus,
      });
      return;
    }

    let verifiedOrderNumber = orderNumber;
    if (paymentMethod === 'uba_redvault') {
      paymentCompletionStartedRef.current = true;
      clearPendingLoadTimeout();
      setPaymentStatus('processing');
      try {
        const outcome = await verifyRedvaultPayment(reference || '');
        if (!isMountedRef.current) return;
        if (outcome === 'pending' || outcome === 'held') {
          setPaymentStatus(outcome);
          return;
        }
        verifiedOrderNumber = outcome.orderNumber || orderNumber;
        // The persisted fence must clear now: otherwise the next submit
        // resolves this paid order, clears the new cart, and routes back
        // here instead of placing the new purchase. Retry transient
        // storage failures before degrading to best-effort — verification
        // already succeeded, so cleanup must never revert to pending.
        try {
          await clearPersistedRedvaultOrderWithRetry();
        } catch {
          // A fence that will not clear is left for the next resolver
          // pass; the verified payment still succeeds below.
        }
        try {
          const trackingContext = await loadRedvaultPurchaseTrackingContext(
            orderId || ''
          );
          if (trackingContext) {
            // The order-created path claims its own scoped key — emit only
            // on a fresh claim.
            if (await claimCheckoutPurchaseTracking(orderId || '')) {
              await trackCheckoutRoutePurchaseCompleted({
                ...trackingContext,
                orderId: orderId || '',
                orderNumber: verifiedOrderNumber || trackingContext.orderNumber,
              });
              await clearRedvaultPurchaseTrackingContext(orderId || '');
            } else if (await isCheckoutPurchaseClaimed(orderId || '')) {
              // The claim is actually held, so the purchase went out
              // through another path: the saved context is stale and must
              // not linger in AsyncStorage indefinitely.
              await clearRedvaultPurchaseTrackingContext(orderId || '');
            }
            // Otherwise the store itself was unavailable (a denial is not
            // proof of emission): retain the context so a later retry
            // still has the email/phone/items snapshot — clearing here
            // would destroy the only copy without any purchase going out.
          }
        } catch {
          // Verification already succeeded; ignore analytics failures.
        }
      } catch {
        if (!isMountedRef.current) return;
        setErrorMessage(
          'We could not confirm your UBA payment yet. Do not pay again; check your orders shortly.'
        );
        setPaymentStatus('pending');
        return;
      }
    }

    paymentCompletionStartedRef.current = true;
    clearPendingLoadTimeout();
    setPaymentStatus('success');
    if (orderId) {
      // Prefer the canonical order total: `amount` is only the residual due
      // at the gateway after wallet/savings credits.
      const purchaseTotal = orderTotal ?? amount ?? 0;
      // A completion-looking redirect proves association, not settlement:
      // only a server-confirmed paid order records the conversion here.
      // Unverified orders still navigate to success, where settlement
      // polling may complete them once the webhook marks them paid.
      const verification = await verifyOrderPaymentForCompletion({
        orderId,
        trackingToken,
        reference,
      });
      if (verification.paid) {
        // The tracked order already carries the checkout identity,
        // breakdown, and line items: forward them so the durable claim is
        // consumed with full attribution (later polling cannot enrich it).
        // First completion wins the durable claim; replays emit nothing.
        await trackCheckoutPaymentCompletedOnce({
          customerEmail: verification.customerEmail,
          customerPhone: verification.customerPhone,
          items: verification.items,
          orderId,
          orderNumber: orderNumber || orderId,
          paymentMethod: gateway || 'payment_gateway',
          reference,
          shipping: verification.shipping,
          subtotal: verification.subtotal,
          tax: verification.tax,
          value: verification.total ?? purchaseTotal,
        });
      } else if (verification.terminalFailure) {
        // Definitive gateway outcome: the payment cannot settle, so keep
        // the cart and the error/retry path instead of navigating to a
        // false "Order Confirmed".
        paymentCompletionStartedRef.current = false;
        setPaymentStatus('error');
        setErrorMessage(
          verification.terminalFailure === 'cancelled'
            ? 'Payment was cancelled before completion. You can try again.'
            : 'Payment could not be confirmed. Please try again.'
        );
        return;
      } else if (verification.reconciliation) {
        // Captured money with no active paid order: route to the
        // reconciliation state instead of the generic confirmation. The
        // cart stays intact for a fresh attempt; settlement polling is
        // skipped there since a cancelled order can never become paid.
        scheduleDelayedNavigation(() => {
          router.replace({
            pathname: '/order-success',
            params: {
              orderId: orderId || '',
              orderNumber: orderNumber || '',
              paymentMethod: gateway,
              reference: reference || '',
              reconciliation: verification.reconciliation,
              ...(trackingToken && { trackingToken }),
            },
          });
        });
        return;
      }
    }
    await clearCart();
    scheduleDelayedNavigation(() => {
      router.replace({
        pathname: '/order-success',
        params: {
          orderId: orderId || '',
          orderNumber: verifiedOrderNumber || '',
          paymentMethod: gateway,
          reference: reference || '',
          ...(trackingToken && { trackingToken }),
        },
      });
    });
  };

  return { beginPaymentCompletion, beginVtuPaymentCompletion };
}
