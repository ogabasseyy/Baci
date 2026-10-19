import { toast } from '@/hooks/use-toast';
import { captureCheckoutPaymentCompleted } from '../capture-checkout-payment-completed';
import { captureCheckoutPaymentFailed } from '../capture-checkout-payment-failed';
import { clearCheckoutIdempotencyKey } from '../checkout-idempotency';
import type { CheckoutPaymentDispatchContext } from './checkout-payment-dispatch-context';
import { completeCheckoutOrder } from './complete-checkout-order';
import { initializeCheckoutGateway } from './initialize-checkout-gateway';
import { openCheckoutCreditDirect } from './open-checkout-credit-direct';
import { openCheckoutCredpal } from './open-checkout-credpal';
import { startCheckoutBankTransfer } from './start-checkout-bank-transfer';
import { startCheckoutRedvault } from './start-checkout-redvault';

export async function dispatchCheckoutPayment(
  context: CheckoutPaymentDispatchContext
): Promise<void> {
  const {
    merchant,
    order,
    paymentMethod,
    total,
    paymentAmount,
    createdOrderNumber,
    orderChargeCurrency,
    firstName,
    lastName,
    customerEmail,
    customerPhone,
    billingAddress,
    checkoutFingerprint,
    checkoutCart,
    cart,
    orderItems,
    setIsProcessing,
    isOrderInFlightRef,
    setPendingCryptoOrder,
    setShowCryptoSelector,
    setCryptoPaymentData,
    capturePaymentStarted,
    hasPaymentStarted,
    setInitializedReference,
    clearPendingCheckoutOrder,
    clearCheckoutSession,
    clearCart,
    navigate,
    redirect,
    payForMeDetails,
  } = context;
  if (paymentMethod === 'bank_transfer')
    return startCheckoutBankTransfer(context);
  if (paymentMethod === 'uba_redvault') return startCheckoutRedvault(context);
  if (
    paymentMethod === 'paystack' ||
    paymentMethod === 'korapay' ||
    paymentMethod === 'juicyway' ||
    paymentMethod === 'klump'
  ) {
    // For Juicyway crypto payments, show the selector first
    if (paymentMethod === 'juicyway') {
      setPendingCryptoOrder({
        orderId: order.id,
        trackingToken: order.tracking_token,
        amount: paymentAmount,
        // Canonical row total first (same rule as order_created).
        total: order.total ?? total,
        orderCurrency: orderChargeCurrency,
        customerEmail,
        customerName: `${firstName} ${lastName}`.trim(),
        customerPhone,
        billingAddress,
        items: checkoutCart.map((item) => ({
          name: item.name,
          type: 'physical' as const,
        })),
      });
      setShowCryptoSelector(true);
      setIsProcessing(false);
      isOrderInFlightRef.current = false;
      return;
    }

    // Provider initialization stays in its handler; screen callbacks own
    // redirect and crypto UI effects.
    const paymentResult = await initializeCheckoutGateway({
      merchantId: merchant.id,
      order,
      currency: orderChargeCurrency,
      customerEmail,
      customerName: `${firstName} ${lastName}`.trim(),
      customerPhone,
      gateway: paymentMethod,
      billingAddress,
    });

    if (paymentResult.success && paymentResult.crypto_payment) {
      // Juicyway crypto payment - show wallet address modal
      setInitializedReference(paymentResult.reference);
      capturePaymentStarted(paymentResult.reference);
      setCryptoPaymentData({
        address: paymentResult.crypto_payment.address,
        chain: paymentResult.crypto_payment.chain,
        currency: paymentResult.crypto_payment.currency,
        amount: paymentResult.crypto_payment.amount / 100, // Convert from minor units
        confirmation_time: paymentResult.crypto_payment.confirmation_time,
        orderId: order.id,
        trackingToken: order.tracking_token,
        reference: paymentResult.reference,
        sessionId: paymentResult.session_id || '',
        paymentId: paymentResult.crypto_payment.payment_id || '', // Payment ID for verification
      });
      setIsProcessing(false);
      isOrderInFlightRef.current = false;
      return;
    } else if (paymentResult.success && paymentResult.authorization_url) {
      // NOTE: Don't clear cart here - it causes a flash of empty state
      // Cart will be cleared on the payment callback page after successful payment
      // (location.assign over `href =` — global assignment bails React Compiler)
      // Klump navigates to the BNPL launcher, which records the start
      // from the widget's onOpen: firing here would strand an unmatched
      // start when the launcher lookup, SDK load, or widget fails
      // before Klump opens.
      if (paymentMethod !== 'klump') {
        setInitializedReference(paymentResult.reference);
        capturePaymentStarted(paymentResult.reference);
      }
      redirect(paymentResult.authorization_url);
      return;
    } else if (paymentResult.success && paymentResult.checkout_url) {
      // Juicyway uses checkout_url
      setInitializedReference(paymentResult.reference);
      capturePaymentStarted(paymentResult.reference);
      redirect(paymentResult.checkout_url);
      return;
    } else {
      throw new Error('Payment initialization failed: No auth URL returned');
    }
  } else if (paymentMethod === 'credit_direct') {
    await openCheckoutCreditDirect({
      merchantSlug: merchant.slug || '',
      order,
      amount: paymentAmount,
      currency: orderChargeCurrency,
      orderNumber: createdOrderNumber,
      total,
      customer: {
        email: customerEmail,
        phone: customerPhone,
        name: `${firstName} ${lastName}`.trim(),
      },
      items: orderItems,
      onPaymentStarted: (reference) => {
        setInitializedReference(reference);
        capturePaymentStarted(reference);
      },
      onIdle: () => {
        setIsProcessing(false);
        isOrderInFlightRef.current = false;
      },
      navigate: (path) => navigate(path),
    });
    return;
  } else if (paymentMethod === 'credpal') {
    await openCheckoutCredpal({
      key: process.env.NEXT_PUBLIC_CREDPAL_KEY,
      amount: paymentAmount,
      product: cart.map((item) => item.name).join(', '),
      customerEmail,
      customerName: `${firstName} ${lastName}`.trim(),
      customerPhone,
      order,
      checkoutFingerprint,
      onPaymentStarted: () => capturePaymentStarted(),
      paymentStarted: hasPaymentStarted,
      onPaymentCompleted: (reference) => {
        captureCheckoutPaymentCompleted({
          currency: orderChargeCurrency,
          orderId: order.id,
          orderNumber: createdOrderNumber,
          paymentMethod,
          reference,
          total: order.total ?? paymentAmount,
        });
      },
      onPaymentFailed: () => {
        captureCheckoutPaymentFailed({
          currency: orderChargeCurrency,
          orderId: order.id,
          orderNumber: createdOrderNumber,
          paymentMethod,
          reason: 'credpal_error',
          total: order.total ?? total,
        });
      },
      clearPendingCheckoutOrder,
      clearCheckoutIdempotencyKey,
      clearCheckoutSession,
      clearCart,
      navigate: (path) => navigate(path),
      onUnavailable: () => {
        toast({
          title: 'CredPal Unavailable',
          description:
            'CredPal payment is not available at this time. Please select a different payment method.',
          variant: 'destructive',
        });
        setIsProcessing(false);
      },
      onError: (error) => {
        console.error('CredPal error:', error);
        toast({
          title: 'CredPal Failed',
          description:
            error.message || 'CredPal checkout failed. Please try again.',
          variant: 'destructive',
        });
        setIsProcessing(false);
      },
      releaseSubmitLock: () => {
        setIsProcessing(false);
        isOrderInFlightRef.current = false;
      },
    });
    return;
  } else if (paymentMethod === 'invoice') {
    await completeCheckoutOrder({
      order,
      checkoutFingerprint,
      completion: { kind: 'invoice' },
      clearPendingCheckoutOrder,
      clearCheckoutSession,
      clearCart,
      pushSuccessRoute: (path) => navigate(path),
    });
  } else if (paymentMethod === 'payforme') {
    await completeCheckoutOrder({
      order,
      checkoutFingerprint,
      completion: { kind: 'payforme', payerName: payForMeDetails.name },
      clearPendingCheckoutOrder,
      clearCheckoutSession,
      clearCart,
      pushSuccessRoute: (path) => navigate(path),
    });
  } else {
    await completeCheckoutOrder({
      order,
      checkoutFingerprint,
      completion: { kind: 'standard' },
      clearPendingCheckoutOrder,
      clearCheckoutSession,
      clearCart,
      pushSuccessRoute: (path) => navigate(path),
    });
  }
}
