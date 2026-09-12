import { useState } from 'react';
import type { CheckoutStep } from '@/components/checkout/CheckoutStepper';
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

  const closeRedvaultReview = () => {
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
