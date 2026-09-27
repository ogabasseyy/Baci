'use client';

import { useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { captureCheckoutPaymentFailed } from '../capture-checkout-payment-failed';
import type { useCheckoutStepState } from './use-checkout-step-state';

type Navigation = Pick<
  ReturnType<typeof useCheckoutStepState>,
  'setCurrentStep' | 'setCompletedSteps'
>;
type PaymentFailure = Parameters<typeof captureCheckoutPaymentFailed>[0];
interface SubmissionFailure {
  createdOrderId?: string;
  paymentStarted: boolean;
  payment: Omit<PaymentFailure, 'orderId' | 'reason'>;
}

/** Own the synchronous submit fence and its visible processing/error recovery. */
export function useCheckoutSubmissionState({
  setCurrentStep,
  setCompletedSteps,
}: Navigation) {
  const isOrderInFlightRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const tryBeginSubmission = (paymentBlocked: boolean) => {
    if (isOrderInFlightRef.current || paymentBlocked) return false;
    isOrderInFlightRef.current = true;
    return true;
  };
  const releaseSubmission = () => {
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
  };
  const handleSubmissionError = (
    error: unknown,
    failure: SubmissionFailure
  ) => {
    console.error('Checkout error:', error);
    if (failure.createdOrderId && failure.paymentStarted) {
      captureCheckoutPaymentFailed({
        ...failure.payment,
        orderId: failure.createdOrderId,
        reason: error instanceof Error ? error.name : 'checkout_error',
      });
    }
    toast({
      title: 'Checkout Failed',
      variant: 'destructive',
      description:
        error instanceof Error
          ? error.message
          : 'An error occurred. Please try again.',
    });
    releaseSubmission();
    setCurrentStep('payment');
    setCompletedSteps({ contact: true, delivery: true });
  };
  return {
    isProcessing,
    setIsProcessing,
    isOrderInFlightRef,
    tryBeginSubmission,
    releaseSubmission,
    handleSubmissionError,
  };
}
