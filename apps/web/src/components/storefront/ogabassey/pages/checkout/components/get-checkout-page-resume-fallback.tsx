import type { useCheckoutAttemptSession } from '../hooks/use-checkout-attempt-session';
import { shouldShowResumeGate } from '../should-show-resume-gate';
import { CheckoutResumeFallback } from './CheckoutResumeFallback';

export function getCheckoutPageResumeFallback({
  checkoutAttempt,
  cartEmpty,
  isHydrated,
  requestedOxygenId,
  verifiedOxygenOrderId,
  navigate,
}: {
  checkoutAttempt: ReturnType<typeof useCheckoutAttemptSession>;
  cartEmpty: boolean;
  isHydrated: boolean;
  requestedOxygenId: string | null;
  verifiedOxygenOrderId: string | undefined;
  navigate: (path: string) => void;
}) {
  const {
    resumedOrder,
    preferredGateway,
    isProcessing,
    isLoadingResumedOrder,
    resumeOrderId,
    resumeOrderError,
  } = checkoutAttempt;
  const isAutoTriggerProcessing =
    isHydrated &&
    cartEmpty &&
    resumedOrder &&
    !!preferredGateway &&
    !isProcessing;
  if (
    !shouldShowResumeGate(
      cartEmpty,
      isLoadingResumedOrder,
      Boolean(isAutoTriggerProcessing),
      Boolean(resumeOrderId && resumeOrderError),
      verifiedOxygenOrderId,
      requestedOxygenId
    )
  )
    return null;

  return (
    <CheckoutResumeFallback
      cartEmpty={cartEmpty}
      isAutoTriggerProcessing={isAutoTriggerProcessing}
      isLoadingResumedOrder={isLoadingResumedOrder}
      navigate={navigate}
      resumeOrderError={resumeOrderError}
      resumeOrderId={resumeOrderId}
      resumedOrderId={resumedOrder?.id}
    />
  );
}
