'use client';
import { CheckoutResumeGate } from './CheckoutResumeStatus';

export function CheckoutResumeFallback({ cartEmpty, isAutoTriggerProcessing, isLoadingResumedOrder, navigate, resumeOrderError, resumeOrderId, resumedOrderId }: {
  cartEmpty: boolean;
  isAutoTriggerProcessing: boolean | null;
  isLoadingResumedOrder: boolean | null;
  navigate(path: string): void;
  resumeOrderError: string | null | undefined;
  resumeOrderId: string | null | undefined;
  resumedOrderId: string | undefined;
}) {
  return <CheckoutResumeGate
    capacityRecovery={{validatedResume: Boolean(resumedOrderId && resumedOrderId === resumeOrderId), onReturnToCart: () => navigate('/cart')}}
    cartEmpty={cartEmpty}
    isAutoTriggerProcessing={isAutoTriggerProcessing}
    isLoadingResumedOrder={isLoadingResumedOrder}
    onContactSupport={() => navigate('/contact')}
    onGoHome={() => navigate('/')}
    onRetry={() => window.location.reload()}
    resumeOrderError={resumeOrderError}
    resumeOrderId={resumeOrderId}
  />;
}
