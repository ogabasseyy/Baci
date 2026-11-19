'use client';

import { useEffect, useState } from 'react';
import { isSharedCartCheckoutDeadlineExpired } from '@/hooks/cart/shared-cart-checkout-deadline';

/** Tracks checkout review expiry across timers and browser resume events. */
export function useChatCartCheckoutReviewExpiry(
  monotonicDeadlineMs: number | null,
  epochDeadlineMs: number | null
) {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (monotonicDeadlineMs === null || epochDeadlineMs === null) {
      setExpired(false);
      return;
    }

    if (
      isSharedCartCheckoutDeadlineExpired(
        monotonicDeadlineMs,
        epochDeadlineMs
      )
    ) {
      setExpired(true);
      return;
    }
    setExpired(false);

    const invalidateAfterResume = () => {
      if (document.visibilityState === 'hidden') return;
      if (
        isSharedCartCheckoutDeadlineExpired(
          monotonicDeadlineMs,
          epochDeadlineMs
        )
      ) {
        setExpired(true);
      }
    };
    const timeout = window.setTimeout(
      () => setExpired(true),
      Math.min(
        monotonicDeadlineMs - performance.now(),
        epochDeadlineMs - Date.now()
      )
    );
    document.addEventListener('visibilitychange', invalidateAfterResume);
    window.addEventListener('pageshow', invalidateAfterResume);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener('visibilitychange', invalidateAfterResume);
      window.removeEventListener('pageshow', invalidateAfterResume);
    };
  }, [monotonicDeadlineMs, epochDeadlineMs]);

  return expired;
}
