import { useState } from 'react';
import { Alert } from 'react-native';
import type { CheckoutStep } from '@/components/checkout/CheckoutStepper';
import { clearPersistedRedvaultOrder } from '@/lib/pending-redvault-order';
import { cancelRedvaultOrder } from './cancel-redvault-order';
import type { RedvaultReviewInput } from './redvault/RedvaultOrderReview';

interface UseRedvaultReviewOptions {
  resetPaymentSelection: () => void;
  setStep: (step: CheckoutStep) => void;
}

export function useRedvaultReview({
  resetPaymentSelection,
  setStep,
}: UseRedvaultReviewOptions) {
  const [redvaultReview, setRedvaultReview] =
    useState<RedvaultReviewInput | null>(null);

  const closeRedvaultReview = async (options?: { cancel?: boolean }) => {
    if (!redvaultReview) return;
    if (options?.cancel !== false) {
      // Guest-capable: the order's tracking token authorizes cancellation
      // without a Supabase session, so unauthenticated shoppers can leave
      // the review and release the fence like authed shoppers.
      const result = await cancelRedvaultOrder({
        orderId: redvaultReview.orderResponse.order.id,
        reason: 'Customer cancelled before starting UBA payment',
        trackingToken:
          redvaultReview.orderResponse.order.tracking_token ?? undefined,
      });
      if (result === 'live') {
        Alert.alert(
          'Payment in progress',
          'Your UBA payment is already being processed and can no longer be cancelled from review.'
        );
        return;
      }
      if (result === 'failed') {
        Alert.alert(
          'Order still open',
          'We could not release this order yet. Please keep this screen open and try again.'
        );
        return;
      }
      // The server released the fence (or it was already gone): the
      // persisted record must go too, or the next submit would re-validate
      // a dead order.
      await clearPersistedRedvaultOrder();
    }
    setRedvaultReview(null);
    resetPaymentSelection();
    setStep('payment');
  };

  return {
    closeRedvaultReview,
    openRedvaultReview: setRedvaultReview,
    redvaultReview,
  };
}
