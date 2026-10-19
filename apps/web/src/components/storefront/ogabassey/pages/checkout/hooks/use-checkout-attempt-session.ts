'use client';

import { useEffect, useState } from 'react';
import type { CartItem } from '@/hooks/cart';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { readCheckoutAttemptGeneration } from '../checkout-attempt-generation';
import { deriveCheckoutDisplayModel } from '../derive-checkout-display-model';
import type { LoadResumedCheckoutOrderParams } from '../load-resumed-checkout-order';
import {
  CHECKOUT_PENDING_ORDER_STORAGE_KEY,
  type PendingCheckoutOrderSnapshot,
} from '../pending-checkout-order';
import { resolveCheckoutResumeContext } from '../resolve-checkout-resume-context';
import { usePaymentReturnReset } from '../use-payment-return-reset';
import { useCheckoutResumeLifecycle } from './use-checkout-resume-lifecycle';
import { useCheckoutSubmissionState } from './use-checkout-submission-state';
import { useResumedCheckoutStartFunnel } from './use-resumed-checkout-start-funnel';

interface SearchParams {
  get(name: string): string | null;
}

interface CheckoutAttemptNavigation {
  setCurrentStep: Parameters<
    typeof useCheckoutSubmissionState
  >[0]['setCurrentStep'];
  setCompletedSteps: Parameters<
    typeof useCheckoutSubmissionState
  >[0]['setCompletedSteps'];
  routerPush: (url: string) => void;
  getHref: (path: string) => string;
}

interface CheckoutAttemptForm {
  setCheckoutFields: LoadResumedCheckoutOrderParams['setCheckoutFields'];
  clearCheckoutSession: () => void;
}

interface CheckoutAttemptFunnel {
  checkoutCart: CartItem[];
  checkoutCartTotal: number;
  itemSubtotal: number;
  currencyCode: string;
}

interface UseCheckoutAttemptSessionOptions {
  searchParams: SearchParams;
  merchantId?: string;
  merchantSlug?: string;
  merchantChargeCurrency: string;
  isHydrated: boolean;
  form: CheckoutAttemptForm;
  navigation: CheckoutAttemptNavigation;
  funnel: CheckoutAttemptFunnel;
}

/** Owns persisted order recovery, resume precedence, submission locking and attempt instrumentation. */
export function useCheckoutAttemptSession({
  searchParams,
  merchantId,
  merchantSlug,
  merchantChargeCurrency,
  isHydrated,
  form,
  navigation,
  funnel,
}: UseCheckoutAttemptSessionOptions) {
  const [
    pendingCheckoutOrder,
    setPendingCheckoutOrder,
    clearPendingCheckoutOrder,
  ] = usePersistedState<PendingCheckoutOrderSnapshot | null>(
    CHECKOUT_PENDING_ORDER_STORAGE_KEY,
    null
  );
  const [checkoutOrderCreated, setCheckoutOrderCreated] = useState(false);
  const submission = useCheckoutSubmissionState({
    setCurrentStep: navigation.setCurrentStep,
    setCompletedSteps: navigation.setCompletedSteps,
  });
  const resumeContext = resolveCheckoutResumeContext({
    searchParams,
    pendingCheckoutOrder,
    merchantId,
    merchantSlug,
  });
  const resume = useCheckoutResumeLifecycle({
    ...resumeContext,
    isHydrated,
    hasCheckoutCartItems: funnel.checkoutCart.length > 0,
    setCheckoutFields: form.setCheckoutFields,
    merchantSlug,
    merchantChargeCurrency,
    isProcessing: submission.isProcessing,
    setIsProcessing: submission.setIsProcessing,
    clearCheckoutSession: form.clearCheckoutSession,
    routerPush: navigation.routerPush,
    getHref: navigation.getHref,
  });
  const displayModel = deriveCheckoutDisplayModel({
    checkoutCart: funnel.checkoutCart,
    checkoutCartTotal: funnel.checkoutCartTotal,
    currencyCode: funnel.currencyCode,
    itemSubtotal: funnel.itemSubtotal,
    resumedOrder: resume.resumedOrder,
  });

  usePaymentReturnReset(submission.releaseSubmission);

  useEffect(() => {
    if (
      pendingCheckoutOrder &&
      merchantId &&
      pendingCheckoutOrder.merchantId !== merchantId
    ) {
      clearPendingCheckoutOrder();
    }
  }, [pendingCheckoutOrder, merchantId, clearPendingCheckoutOrder]);

  useResumedCheckoutStartFunnel({
    attemptId: `gen-${readCheckoutAttemptGeneration()}`,
    checkoutCartTotal: funnel.checkoutCartTotal,
    currencyCode: funnel.currencyCode,
    displayItems: displayModel.displayItems,
    effectiveItemSubtotal: displayModel.effectiveItemSubtotal,
    hasCheckoutCartItems: displayModel.hasCheckoutCartItems,
    isHydrated: isHydrated && !checkoutOrderCreated,
    merchantId,
    resumedOrder: resume.resumedOrder,
  });

  return {
    pendingCheckoutOrder,
    setPendingCheckoutOrder,
    clearPendingCheckoutOrder,
    setCheckoutOrderCreated,
    checkoutOrderCreated,
    displayModel,
    ...resumeContext,
    ...submission,
    ...resume,
  };
}
