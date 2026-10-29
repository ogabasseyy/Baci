import { toast } from '@/hooks/use-toast';
import { executeResumedDirectPayment } from '../handlers/direct-payment';
import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';

/** Enter fresh submission only after identity, resumed-payment and delivery checks. */
export async function beginCheckoutOrderSubmission(
  context: CheckoutOrderSubmissionContext
): Promise<
  NonNullable<CheckoutOrderSubmissionContext['merchant']> | undefined
> {
  const {
    cart,
    contact,
    delivery,
    merchant,
    navigation,
    order,
    payment,
    processing,
    resumed,
  } = context;
  const { session: paymentSession } = payment;
  if (
    !processing.tryBeginSubmission(
      paymentSession.redvault.status === 'pending' ||
        paymentSession.redvault.status === 'held'
    )
  )
    return;

  if (!merchant?.id) {
    toast({
      title: 'Error',
      description: 'Merchant context not available. Please try again.',
      variant: 'destructive',
    });
    processing.isOrderInFlightRef.current = false;
    return;
  }
  if (!contact.customerEmail || !contact.firstName || !contact.lastName) {
    toast({
      title: 'Missing Information',
      description: 'Please fill in your name and email.',
      variant: 'destructive',
    });
    processing.isOrderInFlightRef.current = false;
    return;
  }

  if (
    resumed.order &&
    resumed.preferredGateway &&
    cart.checkoutCart.length === 0
  ) {
    processing.setIsProcessing(true);
    await executeResumedDirectPayment({
      resumedOrder: resumed.order,
      preferredGateway: resumed.preferredGateway,
      merchantSlug: merchant.slug,
      merchantChargeCurrency: payment.currencyCode,
      resumeTrackingToken: resumed.trackingToken,
      resumeMerchantSlug: resumed.merchantSlugFromResume,
      setIsProcessing: processing.setIsProcessing,
      clearCheckoutSession: order.clearCheckoutSession,
      routerPush: (url) => navigation.pushSuccessRoute(url),
      getHref: navigation.getHref,
    }).finally(() => {
      processing.isOrderInFlightRef.current = false;
    });
    return;
  }

  if (!delivery.session.validation.isValid) {
    toast({
      title: 'Confirm Delivery',
      description:
        'Please confirm your delivery address and select an available delivery option.',
      variant: 'destructive',
    });
    navigation.setCurrentStep('delivery');
    navigation.setCompletedSteps((previous) => ({
      ...previous,
      delivery: false,
    }));
    processing.releaseSubmission();
    return;
  }
  return merchant;
}
