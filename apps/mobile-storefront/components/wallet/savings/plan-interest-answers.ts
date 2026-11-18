import AsyncStorage from '@react-native-async-storage/async-storage';
import { boundedMapSet } from '@/lib/bounded-map-set';

/**
 * The interest answer a customer gave on the form for a plan just created,
 * by goal id: in memory and on the device, so it outlives an app restart. If
 * the setup start that follows creation never reached the server (offline at
 * that moment), the plan reads as not started; the sheet then finishes setup
 * with this same answer instead of asking the question again (and possibly
 * getting a different, fixed answer). Forgotten once the plan is ready. Only
 * a yes/no per goal id, never personal or money data.
 */
const answers = new Map<string, boolean>();
const MAX_REMEMBERED_PLANS = 64;

export function planInterestAnswerKey(goalId: string): string {
  return `baci:plan-interest-answer:v1:${goalId}`;
}

export async function rememberPlanInterestAnswer(
  goalId: string,
  answer: boolean
): Promise<void> {
  boundedMapSet(answers, goalId, answer, MAX_REMEMBERED_PLANS);
  try {
    await AsyncStorage.setItem(
      planInterestAnswerKey(goalId),
      answer ? '1' : '0'
    );
  } catch {
    // Best effort: the in-memory answer still covers this app run.
  }
}

/** This app run's answer for the goal, without touching storage. */
export function planInterestAnswer(goalId: string): boolean | null {
  return answers.get(goalId) ?? null;
}

/** The answer from this run, else the one saved on the device. */
export async function loadPlanInterestAnswer(
  goalId: string
): Promise<boolean | null> {
  const known = answers.get(goalId);
  if (known !== undefined) return known;
  try {
    const raw = await AsyncStorage.getItem(planInterestAnswerKey(goalId));
    if (raw !== '1' && raw !== '0') return null;
    const answer = raw === '1';
    boundedMapSet(answers, goalId, answer, MAX_REMEMBERED_PLANS);
    return answer;
  } catch {
    return null;
  }
}

/** The plan is set up: its saved answer is no longer needed. */
export async function forgetPlanInterestAnswer(goalId: string): Promise<void> {
  answers.delete(goalId);
  try {
    await AsyncStorage.removeItem(planInterestAnswerKey(goalId));
  } catch {
    // Best effort.
  }
}

/** Tests only: forget every in-memory answer. */
export function resetPlanInterestAnswers(): void {
  answers.clear();
}
