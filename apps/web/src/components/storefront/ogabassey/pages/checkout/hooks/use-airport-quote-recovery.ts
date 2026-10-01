"use client";
import { useEffect } from 'react';
/** Return restored provider selections to delivery until a fresh quote is chosen. */
export function useAirportQuoteRecovery(needsQuote: boolean, currentStep: string, onRecover: () => void) {
  useEffect(() => {
    if (needsQuote && currentStep === 'payment') onRecover();
  }, [needsQuote, currentStep, onRecover]);
}
