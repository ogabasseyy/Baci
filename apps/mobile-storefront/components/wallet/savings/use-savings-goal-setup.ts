import { useEffect, useRef, useState } from 'react';
import {
  retrySavingsGoalSetup,
  setupExistingSavingsGoal,
} from '@/lib/customer-savings';
import { planInterestAnswer } from './plan-interest-answers';

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
 * attempt ends by re-reading status instead of retrying. A retry (offered
 * only once the server says the earlier claim expired) sends no answer: the
 * one stored for the goal is reused.
 */
export function useSavingsGoalSetup({ goalId, merchantId, onSettled }: Input) {
  // A plan created in this app run starts with the form's answer chosen.
  const [choice, setChoice] = useState<boolean | null>(() =>
    planInterestAnswer(goalId)
  );
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [retried, setRetried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  /** Resolves true when a send actually started (false when deduped). */
  const run = async (
    send: () => Promise<unknown>,
    isRetry: boolean
  ): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setSubmitting(true);
    setAttempted(true);
    setRetried(isRetry);
    setError(null);
    try {
      await send();
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
    return true;
  };
  /** Sends the chosen answer (or one passed in, e.g. the form's own). */
  const submit = async (answer: boolean | null = choice) => {
    if (answer === null) return;
    await run(
      () =>
        setupExistingSavingsGoal({
          goalId,
          merchantId,
          interestAccepted: answer,
        }),
      false
    );
  };
  const retry = () =>
    run(() => retrySavingsGoalSetup({ goalId, merchantId }), true);
  return {
    choice,
    setChoice,
    submitting,
    attempted,
    retried,
    error,
    submit,
    retry,
  };
}
