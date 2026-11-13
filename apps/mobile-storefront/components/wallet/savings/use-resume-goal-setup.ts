import { useEffect, useState } from 'react';
import {
  forgetPlanInterestAnswer,
  loadPlanInterestAnswer,
  planInterestAnswer,
} from './plan-interest-answers';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

/**
 * Finishes the setup of a plan whose first setup start never reached the
 * server: when the status reads not started and the form's interest answer
 * is still known (from this run, or saved on the device), it submits that
 * answer once (per screen), so the customer is not asked the same question
 * again. `resuming` is true from then until that submit fails; if it fails,
 * the usual question shows with the answer preselected. Once the plan is
 * ready, the saved answer is forgotten.
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
  const inMemory = active ? planInterestAnswer(goalId) : null;
  const [stored, setStored] = useState<{
    goalId: string;
    answer: boolean;
  } | null>(null);
  // After a restart the answer is only on the device: read it when needed.
  useEffect(() => {
    if (!active || inMemory !== null || phase !== 'not_started') return;
    let live = true;
    void loadPlanInterestAnswer(goalId).then((answer) => {
      if (live && answer !== null) setStored({ goalId, answer });
    });
    return () => {
      live = false;
    };
  }, [active, inMemory, phase, goalId]);
  const answer = inMemory ?? (stored?.goalId === goalId ? stored.answer : null);
  const [sentFor, setSentFor] = useState<string | null>(null);
  const sent = sentFor === goalId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: submit is a fresh closure each render; the phase, answer and goal identify the attempt.
  useEffect(() => {
    if (answer === null || phase !== 'not_started' || sent) return;
    setSentFor(goalId);
    setChoice(answer);
    void submit(answer);
  }, [answer, phase, sent, goalId]);
  useEffect(() => {
    if (active && phase === 'ready') void forgetPlanInterestAnswer(goalId);
  }, [active, phase, goalId]);
  return { resuming: answer !== null && !failed };
}
