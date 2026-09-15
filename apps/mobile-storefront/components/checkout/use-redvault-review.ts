import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { CheckoutStep } from '@/components/checkout/CheckoutStepper';
import { createStorefrontCustomerApiClient } from '@/lib/storefront-customer-api-client';
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
  const apiClientRef = useRef(createStorefrontCustomerApiClient());

  const closeRedvaultReview = async (options?: { cancel?: boolean }) => {
    if (!redvaultReview) return;
    if (options?.cancel !== false) {
      try {
        await apiClientRef.current.fetchJson({
          body: { reason: 'Customer cancelled before starting UBA payment' },
          method: 'POST',
          path: `/api/storefront/account/orders/${redvaultReview.orderResponse.order.id}/cancel`,
        });
      } catch {
        Alert.alert(
          'Order still open',
          'We could not release this order yet. Please keep this screen open and try again.'
        );
        return;
      }
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
