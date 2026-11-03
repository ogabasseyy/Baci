import { toast } from '@/hooks/use-toast';
import { executeResumedDirectPayment } from '../handlers/direct-payment';
import { recoverRedvaultUncertainAttempt } from '../handlers/recover-redvault-uncertain-attempt';
import { isResumedDirectPayment } from '../is-resumed-direct-payment';
import { isTerminalRedvaultReview } from '../is-terminal-redvault-review';
import { readRedvaultUncertainAttempt } from '../redvault-uncertain-attempt';
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
  const uncertain = readRedvaultUncertainAttempt(merchant.id);
  if (uncertain.kind !== 'none') {
    processing.setIsProcessing(true);
    const result =
      uncertain.kind === 'pending'
        ? await recoverRedvaultUncertainAttempt({
            merchantId: merchant.id,
            merchantSlug: merchant.slug,
            pendingOrder: order.pending,
          })
        : { kind: 'unavailable' as const };
    if (result.kind === 'recovered') {
      order.setPending(result.snapshot);
      navigation.setCurrentStep('payment');
      toast({
        title: 'Previous UBA review restored',
        description: 'Please review it before continuing.',
      });
    } else if (result.kind === 'retired') {
      toast({
        title: 'Previous checkout closed',
        description: 'Please review your cart and try checkout again.',
      });
    } else {
      toast({
        title: 'Previous UBA checkout needs attention',
        description:
          'We could not confirm your previous checkout. Please try again or contact the store.',
        variant: 'destructive',
      });
    }
    processing.releaseSubmission();
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
    isResumedDirectPayment({
      resumedOrder: resumed.order,
      preferredGateway: resumed.preferredGateway,
      checkoutItemCount: cart.checkoutCart.length,
    })
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

  if (
    !delivery.session.validation.isValid &&
    !isTerminalRedvaultReview({
      merchantId: merchant.id,
      pendingOrder: order.pending,
      sharedCartEnabled: cart.sharedCartEnabled,
      sharedCartRef: cart.sharedCartRef,
      checkoutItemCount: cart.checkoutCart.length,
    })
  ) {
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
