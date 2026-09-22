import type { MutableRefObject } from 'react';
import type { WebViewNavigation } from 'react-native-webview';
import { trackCheckoutPaymentCompletedOnce } from '@/services/analytics';
import type { createBNPLCheckoutAppNavigation } from './bnpl-checkout-app-navigation';
import { resolveBNPLNavigationUrlEffect } from './bnpl-checkout-controller-actions';
import type {
  BNPLCheckoutStatus,
  BNPLRecordCheckoutFailure,
  BNPLSetCheckoutStatus,
} from './use-bnpl-checkout-controller';

export interface BNPLNavigationHandlerDeps {
  apiBaseUrl: string;
  merchantDomain?: string;
  merchantSlug?: string;
  gateway?: string;
  orderId?: string;
  amount?: string;
  orderTotal?: string;
  customerEmail?: string;
  customerPhone?: string;
  subtotal?: string;
  shipping?: string;
  tax?: string;
  trackingToken?: string;
  clearCart: () => Promise<void>;
  isMountedRef: MutableRefObject<boolean>;
  statusRef: MutableRefObject<BNPLCheckoutStatus>;
  setCheckoutStatus: BNPLSetCheckoutStatus;
  setErrorMessage: (message: string | null) => void;
  clearPendingLoadTimeout: () => void;
  recordCheckoutFailure: BNPLRecordCheckoutFailure;
  trackDocumentUrl: (url: unknown) => void;
  returnToAppFromProviderExit: () => void;
  scheduleOrderSuccess: ReturnType<
    typeof createBNPLCheckoutAppNavigation
  >['scheduleOrderSuccess'];
}

/**
 * Navigation-URL effects: success attribution (including the durable
 * completion claim) and terminal provider error redirects. Extracted from
 * use-bnpl-checkout-controller (300-line file limit).
 */
export function createBNPLNavigationHandlers({
  apiBaseUrl,
  merchantDomain,
  merchantSlug,
  gateway,
  orderId,
  amount,
  orderTotal,
  customerEmail,
  customerPhone,
  subtotal,
  shipping,
  tax,
  trackingToken,
  clearCart,
  isMountedRef,
  statusRef,
  setCheckoutStatus,
  setErrorMessage,
  clearPendingLoadTimeout,
  recordCheckoutFailure,
  trackDocumentUrl,
  returnToAppFromProviderExit,
  scheduleOrderSuccess,
}: BNPLNavigationHandlerDeps) {
  const handleNavigationUrl = async (url: string) => {
    const effect = resolveBNPLNavigationUrlEffect(url, {
      apiBaseUrl,
      gateway,
      merchantDomain,
      merchantSlug,
    });
    if (!effect) {
      return;
    }

    clearPendingLoadTimeout();
    if (effect.status === 'return-to-app') {
      returnToAppFromProviderExit();
      return;
    }

    if (effect.status === 'success') {
      if (statusRef.current === 'success') {
        return;
      }
      setCheckoutStatus('success');
      // Accepted-but-pending provider results still reach the success
      // experience below, but are not paid conversions: skip attribution.
      if (orderId && !effect.isPending) {
        // The approved completion consumes the durable claim immediately:
        // forward the routed guest identity and breakdown snapshot, since
        // success-screen polling cannot enrich the claim afterwards.
        await trackCheckoutPaymentCompletedOnce({
          ...(customerEmail && { customerEmail }),
          ...(customerPhone && { customerPhone }),
          orderId,
          paymentMethod: gateway || 'bnpl',
          reference: effect.reference || undefined,
          ...(shipping !== undefined && { shipping: Number(shipping) }),
          ...(subtotal !== undefined && { subtotal: Number(subtotal) }),
          ...(tax !== undefined && { tax: Number(tax) }),
          // Revenue is the canonical order total, not the residual the
          // provider charged after wallet/savings credit. This immediate
          // path wins the durable claim, so understating here cannot be
          // repaired by the later tracked-order poll. Older routes without
          // orderTotal keep the charged amount.
          value: orderTotal
            ? Number(orderTotal)
            : amount
              ? Number(amount)
              : undefined,
        });
        // The emission can outlive the screen: a late resolution must not
        // erase the cart or route after unmount.
        if (!isMountedRef.current) {
          return;
        }
      }
      await clearCart();
      scheduleOrderSuccess({
        gateway,
        orderId,
        reference: effect.reference,
        trackingToken,
      });
      return;
    }

    // Terminal provider error redirect: capture the failure so declined or
    // broken BNPL attempts are distinguishable from abandonment. Late
    // callbacks arriving after success (e.g. an aborted-load error while
    // the success navigation is replaced) must not flip a paid checkout
    // back to error or double-emit failure beside the completion.
    if (statusRef.current === 'success') {
      return;
    }
    recordCheckoutFailure('bnpl_provider_error');
    setCheckoutStatus(effect.status);
    setErrorMessage(effect.errorMessage);
  };

  const handleNavigationChange = (navState: WebViewNavigation) => {
    // navState.url is always the top-level document (server redirects
    // never reach should-start-load), so it is the freshest main-document
    // signal for HTTP-error classification.
    trackDocumentUrl(navState.url);
    return handleNavigationUrl(navState.url);
  };

  return {
    handleNavigationChange,
    handleNavigationUrl,
  };
}
