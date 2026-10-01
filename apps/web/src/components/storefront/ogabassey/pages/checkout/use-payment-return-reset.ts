'use client';

import { useEffect } from 'react';

/** A hosted gateway can restore the frozen document with its submit lock set. */
export function usePaymentReturnReset(resetProcessing: () => void): void {
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) resetProcessing();
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [resetProcessing]);
}
