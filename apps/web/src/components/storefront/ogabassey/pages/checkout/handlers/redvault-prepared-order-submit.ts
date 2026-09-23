import { toast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
import { cancelStaleCheckoutOrder } from '../cancel-stale-checkout-order';
import { checkoutFingerprintsMatch } from '../checkout-fingerprints-match';
import { initializeRedvaultPayment } from '../redvault-payment-response';
import type { PaymentMethod } from '../types';

export type RedvaultStatus = 'idle' | 'pending' | 'held' | 'error';

export interface RedvaultPreparedOrderBillingAddress {
  line1: string;
  city: string;
  state?: string;
  country: string;
  zip_code?: string;
}

export interface RedvaultPreparedOrder {
  billingAddress: RedvaultPreparedOrderBillingAddress;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  currency: string;
  orderId: string;
  checkoutFingerprint: string;
  trackingToken?: string;
}

export interface RedvaultPaymentStarted {
  orderId: string;
  currency: string;
  reference?: string;
}

export interface SubmitRedvaultPreparedOrderOptions {
  paymentMethod: PaymentMethod;
  redvaultOrderReady: RedvaultPreparedOrder | null;
  checkoutFingerprint: string;
  waitForResolvedStorefrontCustomerAuth: () => Promise<boolean>;
  isOrderInFlightRef: { current: boolean };
  setIsProcessing: (value: boolean) => void;
  setRedvaultStatus: (status: RedvaultStatus) => void;
  setRedvaultOrderReady: (order: RedvaultPreparedOrder | null) => void;
  clearPendingCheckoutOrder: () => void;
  createAccount: boolean;
  /** Only truthiness is read: guests sign up before initialization. */
  user: unknown;
  accountPassword: string;
  firstName: string;
  lastName: string;
  merchantId: string;
  /**
   * Records the funnel start when initialization opens the provider
   * flow: without it the attempt jumps from order_created straight to
   * completion/failure.
   */
  onPaymentStarted?: (start: RedvaultPaymentStarted) => void;
}

/**
 * Initializes a REDVAULT order prepared by an earlier submit click. Runs
 * AFTER validation and fingerprinting.
 *
 * @returns true when the submit was fully handled (redirect, held, error,
 * or reconciliation state) and the caller must return; false to continue
 * with a fresh order.
 */
export async function submitRedvaultPreparedOrder({
  paymentMethod,
  redvaultOrderReady,
  checkoutFingerprint,
  waitForResolvedStorefrontCustomerAuth,
  isOrderInFlightRef,
  setIsProcessing,
  setRedvaultStatus,
  setRedvaultOrderReady,
  clearPendingCheckoutOrder,
  createAccount,
  user,
  accountPassword,
  firstName,
  lastName,
  merchantId,
  onPaymentStarted,
}: SubmitRedvaultPreparedOrderOptions): Promise<boolean> {
  // A REDVAULT order prepared by an earlier click initializes here, AFTER
  // validation and fingerprinting. The prepared order is bound to the
  // checkout fingerprint: edited contact/delivery/cart inputs cancel and
  // recreate it instead of initializing a stale order with skipped
  // validation. A live (409) cancel keeps the prepared order and replays
  // it instead of opening a second order; cancelled/gone recreates. A
  // failed cancel keeps the fence and blocks: the prepared order may
  // still hold its reservation, so clearing it would strand inventory
  // while the replacement order fails against held stock.
  let activeRedvaultOrder =
    paymentMethod === 'uba_redvault' ? redvaultOrderReady : null;
  if (
    activeRedvaultOrder &&
    !checkoutFingerprintsMatch(
      activeRedvaultOrder.checkoutFingerprint,
      checkoutFingerprint
    )
  ) {
    const staleCancel = await cancelStaleCheckoutOrder({
      // This route mounts no auth provider, so `user` is always null
      // here: resolve the cookie session or signed-in customers cancel
      // down the guest route and mis-route to the recreate branch.
      isAuthenticated: await waitForResolvedStorefrontCustomerAuth(),
      orderId: activeRedvaultOrder.orderId,
      reason: 'Checkout details changed before UBA payment',
      trackingToken: activeRedvaultOrder.trackingToken,
    });
    if (staleCancel === 'live') {
      console.warn(
        'Prepared REDVAULT order already initializing; replaying it.'
      );
    } else if (staleCancel === 'failed') {
      // Unproven (timeout, server error, no ownership proof): keep the
      // fence and stop this submit instead of recreating. The retry
      // re-attempts the same cancellation; clearing here would strand
      // the reservation while the replacement fails against held stock.
      toast({
        title: 'Order Still Processing',
        description:
          'We could not release your previous order. Please try again.',
        variant: 'destructive',
      });
      isOrderInFlightRef.current = false;
      setIsProcessing(false);
      return true;
    } else {
      // Cancelled or gone: the prepared order never initialized — this
      // branch is the only initializer and it clears the state first —
      // so nothing is payable and recreating below is safe.
      activeRedvaultOrder = null;
      setRedvaultOrderReady(null);
      clearPendingCheckoutOrder();
    }
  }
  if (activeRedvaultOrder) {
    setIsProcessing(true);
    setRedvaultStatus('pending');
    // Guest signup establishes a session before initialization: the
    // guest application was created with a null user_id, so the new
    // account must adopt it first or every customer-bound recovery RPC
    // rejects the changed identity and the live order can never replay
    // its authorization URL. Signup failures stay tolerated (email may
    // already exist); only an established session with a failed attach
    // blocks payment, and the retry re-attempts the attach.
    if (createAccount && !user && accountPassword.length >= 6) {
      const supabase = createClient();
      try {
        await supabase.auth.signUp({
          email: activeRedvaultOrder.customerEmail,
          password: accountPassword,
          options: {
            data: {
              first_name: firstName,
              last_name: lastName,
              phone: activeRedvaultOrder.customerPhone,
              source: 'checkout',
              signup_type: 'customer',
            },
          },
        });
      } catch (authError) {
        console.error('Silent signup background error:', authError);
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      // The attach RPC requires the order's tracking token as
      // order-bound proof; without the persisted token there is nothing
      // to prove with, so skip the attach and let initialization run
      // under the guest identity instead of failing the payment.
      if (session && activeRedvaultOrder.trackingToken) {
        const { data: attached, error: attachError } = await supabase.rpc(
          'attach_redvault_guest_application_to_customer',
          {
            p_order_id: activeRedvaultOrder.orderId,
            p_tracking_token: activeRedvaultOrder.trackingToken,
          }
        );
        // The RPC is idempotent for the owning caller, so false means
        // the checkout is genuinely not ours: block like an error.
        if (attachError || attached !== true) {
          console.error('Guest checkout attach error:', attachError);
          setRedvaultStatus('error');
          setIsProcessing(false);
          isOrderInFlightRef.current = false;
          return true;
        }
      }
    }
    let paymentResult: Awaited<ReturnType<typeof initializeRedvaultPayment>>;
    try {
      paymentResult = await initializeRedvaultPayment({
        merchantId,
        orderId: activeRedvaultOrder.orderId,
        currency: activeRedvaultOrder.currency,
        customerEmail: activeRedvaultOrder.customerEmail,
        customerName: activeRedvaultOrder.customerName,
        customerPhone: activeRedvaultOrder.customerPhone,
        trackingToken: activeRedvaultOrder.trackingToken,
        billingAddress: activeRedvaultOrder.billingAddress,
      });
    } catch {
      setRedvaultStatus('error');
      setIsProcessing(false);
      isOrderInFlightRef.current = false;
      return true;
    }
    setRedvaultOrderReady(null);
    if (paymentResult.kind === 'pending_reconciliation') {
      setIsProcessing(false);
      isOrderInFlightRef.current = false;
      return true;
    }
    if (paymentResult.kind === 'captured_held') {
      setRedvaultStatus('held');
      setIsProcessing(false);
      isOrderInFlightRef.current = false;
      return true;
    }
    onPaymentStarted?.({
      orderId: activeRedvaultOrder.orderId,
      currency: activeRedvaultOrder.currency,
      reference: paymentResult.reference,
    });
    window.location.assign(paymentResult.authorizationUrl);
    return true;
  }
  return false;
}
