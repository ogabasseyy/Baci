import { initializeRedvaultPayment } from '../redvault-payment-response';
import type { CheckoutPaymentDispatchContext } from './checkout-payment-dispatch-context';

export async function startCheckoutRedvault(
  context: CheckoutPaymentDispatchContext
): Promise<void> {
  const {
    merchant,
    order,
    orderChargeCurrency,
    firstName,
    lastName,
    customerEmail,
    customerPhone,
    billingAddress,
    setIsProcessing,
    isOrderInFlightRef,
    setRedvaultStatus,
    capturePaymentStarted,
    redirect,
    completeSignup,
  } = context;

  setRedvaultStatus('pending');
  const paymentResult = await initializeRedvaultPayment({
    merchantId: merchant.id,
    orderId: order.id,
    currency: orderChargeCurrency,
    customerEmail,
    customerName: `${firstName} ${lastName}`.trim(),
    customerPhone,
    trackingToken: order.tracking_token,
    billingAddress,
  }).catch((error: unknown) => {
    setRedvaultStatus('error');
    throw error;
  });
  if (paymentResult.kind === 'pending_reconciliation') {
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    return;
  }
  if (paymentResult.kind === 'captured_held') {
    setRedvaultStatus('held');
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    return;
  }
  // The REDVAULT attempt opens now: record the start with the init
  // reference so the funnel does not jump from order_created
  // straight to completion/failure.
  capturePaymentStarted(paymentResult.reference);
  await completeSignup();
  redirect(paymentResult.authorizationUrl);
  return;
}
