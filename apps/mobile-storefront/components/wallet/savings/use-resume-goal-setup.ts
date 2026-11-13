import { useEffect, useState } from 'react';
import { planInterestAnswer } from './plan-interest-answers';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

/**
 * Finishes the setup of a plan created in this app run whose first setup
 * start never reached the server: when the status reads not started and the
 * form's interest answer is still known, it submits that answer once (per
 * screen), so the customer is not asked the same question again.
 * `resuming` is true from then until that submit fails; if it fails, the
 * usual question shows with the answer preselected.
 */
export function useResumeGoalSetup({
  active,
  goalId,
  phase,
  failed,
  setChoice,
  submit,
}: {
  active: boolean;
  goalId: string;
  phase: SavingsPlanFundingPhase;
  /** The resumed submit came back with an error. */
  failed: boolean;
  setChoice: (choice: boolean) => void;
  submit: (choice: boolean) => Promise<unknown>;
}): { resuming: boolean } {
  const answer = active ? planInterestAnswer(goalId) : null;
  const [sentFor, setSentFor] = useState<string | null>(null);
  const sent = sentFor === goalId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: submit is a fresh closure each render; the phase, answer and goal identify the attempt.
  useEffect(() => {
    if (answer === null || phase !== 'not_started' || sent) return;
    setSentFor(goalId);
    setChoice(answer);
    void submit(answer);
  }, [answer, phase, sent, goalId]);
  return { resuming: answer !== null && !failed };
}
