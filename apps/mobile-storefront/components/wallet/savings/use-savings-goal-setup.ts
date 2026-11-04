import { useEffect, useRef, useState } from 'react';
import { setupExistingSavingsGoal } from '@/lib/customer-savings';

type Input = {
  goalId: string;
  merchantId: string;
  /** Re-reads the goal's status; runs after every attempt, success or not. */
  onSettled: () => void;
};

/**
 * Submits the customer's explicit interest answer for an existing goal that
 * was never set up. There is no default answer: nothing is sent until the
 * customer has chosen. A failed or lost response is indeterminate, so every
 * attempt ends by re-reading status instead of retrying.
 */
export function useSavingsGoalSetup({ goalId, merchantId, onSettled }: Input) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const submit = async () => {
    if (choice === null || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setAttempted(true);
    setError(null);
    try {
      await setupExistingSavingsGoal({
        goalId,
        merchantId,
        interestAccepted: choice,
      });
    } catch {
      if (mounted.current)
        setError(
          "We couldn't confirm this goal's setup. Its status is being checked again."
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setSubmitting(false);
        onSettled();
      }
    }
  };
  return { choice, setChoice, submitting, attempted, error, submit };
}
