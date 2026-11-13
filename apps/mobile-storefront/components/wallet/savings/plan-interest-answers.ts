import { boundedMapSet } from '@/lib/bounded-map-set';

/**
 * The interest answer a customer gave on the form for a plan just created,
 * kept for this app run by goal id. If the setup start that follows creation
 * never reached the server (offline at that moment), the plan reads as not
 * started; the sheet then finishes setup with this same answer instead of
 * asking the question again. Only a yes/no, never personal or money data.
 */
const answers = new Map<string, boolean>();
const MAX_REMEMBERED_PLANS = 64;

export function rememberPlanInterestAnswer(goalId: string, answer: boolean) {
  boundedMapSet(answers, goalId, answer, MAX_REMEMBERED_PLANS);
}

export function planInterestAnswer(goalId: string): boolean | null {
  return answers.get(goalId) ?? null;
}

/** Tests only: forget every answer. */
export function resetPlanInterestAnswers(): void {
  answers.clear();
}
