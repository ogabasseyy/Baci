'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { executeResumedDirectPayment } from '../handlers/direct-payment';
import type { LoadResumedCheckoutOrderParams } from '../load-resumed-checkout-order';
import type { CheckoutResumeContext } from '../resolve-checkout-resume-context';
import type { ResumedOrder } from '../types';
import { useLoadResumedOrder } from './use-load-resumed-order';

interface UseCheckoutResumeLifecycleOptions extends CheckoutResumeContext {
  isHydrated: boolean;
  hasCheckoutCartItems: boolean;
  setCheckoutFields: LoadResumedCheckoutOrderParams['setCheckoutFields'];
  merchantSlug?: string;
  merchantChargeCurrency: string;
  isProcessing: boolean;
  setIsProcessing: (isProcessing: boolean) => void;
  clearCheckoutSession: () => void;
  routerPush: (url: string) => void;
  getHref: (path: string) => string;
}

/** Owns resumed-order loading, form hydration and one-shot direct payment dispatch. */
export function useCheckoutResumeLifecycle({
  resumeOrderId,
  resumeTrackingToken,
  resumeLookupEmail,
  resumeMerchantSlug,
  preferredGateway,
  isHydrated,
  hasCheckoutCartItems,
  setCheckoutFields,
  merchantSlug,
  merchantChargeCurrency,
  isProcessing,
  setIsProcessing,
  clearCheckoutSession,
  routerPush,
  getHref,
}: UseCheckoutResumeLifecycleOptions) {
  const [resumedOrder, setResumedOrder] = useState<ResumedOrder | null>(null);
  const [isLoadingResumedOrder, setIsLoadingResumedOrder] = useState(
    Boolean(resumeOrderId)
  );
  const [resumeOrderError, setResumeOrderError] = useState<string | null>(null);
  const autoTriggerRef = useRef(false);

  useLoadResumedOrder({
    resumeOrderId: isHydrated && !hasCheckoutCartItems ? resumeOrderId : null,
    resumeMerchantSlug,
    resumeTrackingToken,
    resumeLookupEmail,
    setIsLoadingResumedOrder,
    setResumedOrder,
    setCheckoutFields,
    setResumeOrderError,
  });

  const triggerDirectPayment = useEffectEvent(() =>
    executeResumedDirectPayment({
      resumedOrder,
      preferredGateway,
      merchantSlug,
      merchantChargeCurrency,
      resumeTrackingToken,
      resumeMerchantSlug,
      setIsProcessing,
      clearCheckoutSession,
      routerPush,
      getHref,
    })
  );

  useEffect(() => {
    if (
      isHydrated &&
      !hasCheckoutCartItems &&
      resumedOrder &&
      preferredGateway &&
      !isProcessing &&
      !autoTriggerRef.current
    ) {
      autoTriggerRef.current = true;
      void triggerDirectPayment();
    }
  }, [
    hasCheckoutCartItems,
    isHydrated,
    isProcessing,
    preferredGateway,
    resumedOrder,
  ]);

  return { resumedOrder, isLoadingResumedOrder, resumeOrderError };
}
