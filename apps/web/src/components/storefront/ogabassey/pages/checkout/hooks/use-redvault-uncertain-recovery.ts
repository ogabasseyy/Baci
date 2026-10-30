'use client';

import { useEffect, useRef } from 'react';
import { isCartSessionRetiring } from '@/hooks/cart/cart-session-write-fence';
import { getCartSessionGeneration } from '@/hooks/cart/shared-cart-storage';
import { toast } from '@/hooks/use-toast';
import { recoverRedvaultUncertainAttempt } from '../handlers/recover-redvault-uncertain-attempt';
import type { PendingCheckoutOrderSnapshot } from '../pending-checkout-order';
import { readRedvaultUncertainAttempt } from '../redvault-uncertain-attempt';

/** Restore the reviewed order after a lost response, without starting payment. */
export function useRedvaultUncertainRecovery(options: {
  merchantId?: string;
  merchantSlug?: string;
  isHydrated: boolean;
  pendingOrder: PendingCheckoutOrderSnapshot | null;
  setPendingOrder: (snapshot: PendingCheckoutOrderSnapshot) => void;
  setIsProcessing: (value: boolean) => void;
  setCurrentStep: (step: 'payment') => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const active = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const { merchantId, merchantSlug, isHydrated } = options;
  useEffect(() => {
    if (!isHydrated || !merchantId || running.current) return;
    const stored = readRedvaultUncertainAttempt(merchantId);
    if (stored.kind === 'none') return;
    running.current = true;
    const generation = getCartSessionGeneration(merchantSlug);
    latest.current.setIsProcessing(true);
    void recoverRedvaultUncertainAttempt({
      merchantId,
      merchantSlug,
      pendingOrder: latest.current.pendingOrder,
    })
      .then((result) => {
        if (
          !active.current ||
          latest.current.merchantId !== merchantId ||
          getCartSessionGeneration(merchantSlug) !== generation ||
          isCartSessionRetiring(merchantSlug)
        )
          return;
        if (result.kind === 'recovered') {
          latest.current.setPendingOrder(result.snapshot);
          latest.current.setCurrentStep('payment');
          toast({
            title: 'Previous UBA review restored',
            description: 'Please review it before continuing.',
          });
        } else if (result.kind === 'retired') {
          toast({
            title: 'Previous checkout closed',
            description: 'Please review your cart and try checkout again.',
          });
        } else if (result.kind === 'unavailable') {
          toast({
            title: 'Previous UBA checkout needs attention',
            description:
              'We could not confirm your previous checkout. Please try again or contact the store.',
            variant: 'destructive',
          });
        }
      })
      .finally(() => {
        running.current = false;
        if (active.current && latest.current.merchantId === merchantId) {
          latest.current.setIsProcessing(false);
        }
      });
  }, [merchantId, merchantSlug, isHydrated]);
}
