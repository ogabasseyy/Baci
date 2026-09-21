'use client';

import { useEffect, useRef, useState } from 'react';
import type { CryptoVerificationStatus } from '../types';

export interface JuicywayVerificationTarget {
  paymentId?: string | null;
  sessionId?: string | null;
}

export interface UseJuicywayVerificationOptions {
  target: JuicywayVerificationTarget | null;
  onConfirmed: () => void;
  onTerminalFailure: (reason: string) => void;
}

type VerificationOutcome = 'confirmed' | 'failed' | 'pending';

// 5 minutes of polling before the deposit is left pending for a later check.
const VERIFY_POLL_MAX_ATTEMPTS = 30;
const VERIFY_POLL_INTERVAL_MS = 10_000;

// Module scope: the try/catch statements below would otherwise block React
// Compiler memoization of the hook.
async function checkJuicywayPaymentStatus(
  verificationId: string
): Promise<VerificationOutcome> {
  try {
    // Use payment_id parameter for GET /payments/{id} endpoint
    const response = await fetch(
      `/api/payments/status?gateway=juicyway&payment_id=${verificationId}`
    );

    if (!response.ok) {
      // Try to parse error, but handle JSON parse failures gracefully
      let errorData = {};
      try {
        errorData = await response.json();
      } catch {
        errorData = { message: `HTTP ${response.status}: ${response.statusText}` };
      }
      console.error('Payment status check failed:', {
        status: response.status,
        statusText: response.statusText,
        paymentId: verificationId,
        error: errorData,
      });
      return 'pending'; // Treat API errors as pending, not failed
    }

    const result = await response.json();

    if (result.is_confirmed) {
      return 'confirmed';
    }

    if (result.is_failed) {
      return 'failed';
    }

    return 'pending';
  } catch (error) {
    console.error('Payment verification error:', error);
    return 'pending';
  }
}

/**
 * Owns Juicyway deposit verification polling: immediate status check,
 * interval polling with an attempt cap, and terminal callbacks.
 * Extracted from use-juicyway-payment (300-line file limit).
 */
export function useJuicywayVerification({
  target,
  onConfirmed,
  onTerminalFailure,
}: UseJuicywayVerificationOptions) {
  const [isVerifying, setIsVerifying] = useState(false);
  const [status, setStatus] = useState<CryptoVerificationStatus>('idle');

  // Uses a ref to track polling state to avoid stale closure issues.
  // The epoch invalidates in-flight status checks when a new attempt
  // supersedes the current one or the modal is dismissed mid-poll.
  const pollingRef = useRef<{
    intervalId: NodeJS.Timeout | null;
    attempts: number;
    epoch: number;
  }>({
    intervalId: null,
    attempts: 0,
    epoch: 0,
  });

  const clearPollingInterval = () => {
    if (pollingRef.current.intervalId) {
      clearInterval(pollingRef.current.intervalId);
      pollingRef.current.intervalId = null;
    }
  };

  const verify = async () => {
    // Use paymentId for verification (from the capture response)
    // Fall back to sessionId if paymentId is not available
    const verificationId = target?.paymentId || target?.sessionId;

    if (!verificationId) {
      console.error('No payment ID or session ID available for verification');
      // With no payment at all there is no attempt to settle: the failure
      // callback still runs (and no-ops on the null payment), preserving
      // the idle state.
      if (target) {
        setIsVerifying(false);
        setStatus('failed');
      }
      onTerminalFailure('juicyway_error');
      return;
    }

    // A new attempt supersedes any prior poll: drop its interval and
    // invalidate its in-flight status checks so a stale resolution can
    // never clear this poll or settle the wrong attempt.
    pollingRef.current.epoch += 1;
    const epoch = pollingRef.current.epoch;
    clearPollingInterval();
    setIsVerifying(true);
    setStatus('checking');
    pollingRef.current.attempts = 0;

    // Initial check
    const initialStatus = await checkJuicywayPaymentStatus(verificationId);
    if (epoch !== pollingRef.current.epoch) {
      return;
    }

    if (initialStatus === 'confirmed') {
      setIsVerifying(false);
      setStatus('confirmed');
      onConfirmed();
      return;
    }

    if (initialStatus === 'failed') {
      setIsVerifying(false);
      setStatus('failed');
      onTerminalFailure('juicyway_error');
      return;
    }

    // Start polling
    setStatus('pending');

    pollingRef.current.intervalId = setInterval(async () => {
      if (epoch !== pollingRef.current.epoch) {
        return;
      }
      pollingRef.current.attempts++;

      if (pollingRef.current.attempts >= VERIFY_POLL_MAX_ATTEMPTS) {
        clearPollingInterval();
        setIsVerifying(false);
        setStatus('pending');
        return;
      }

      const pollStatus = await checkJuicywayPaymentStatus(verificationId);
      if (epoch !== pollingRef.current.epoch) {
        // Superseded while the check was in flight: never clear the new
        // poll or settle this attempt.
        return;
      }

      if (pollStatus === 'confirmed') {
        clearPollingInterval();
        setIsVerifying(false);
        setStatus('confirmed');
        onConfirmed();
      } else if (pollStatus === 'failed') {
        clearPollingInterval();
        setIsVerifying(false);
        setStatus('failed');
        onTerminalFailure('juicyway_error');
      }
    }, VERIFY_POLL_INTERVAL_MS);
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current.intervalId) {
        clearInterval(pollingRef.current.intervalId);
      }
    };
  }, []);

  const reset = () => {
    // Dismissed mid-poll: drop the interval and invalidate in-flight
    // checks so a stale tick can neither clear a later poll nor settle
    // this attempt after the modal closed.
    pollingRef.current.epoch += 1;
    clearPollingInterval();
    setIsVerifying(false);
    setStatus('idle');
  };

  return { isVerifying, status, verify, reset };
}
