import type {
  QuizActiveAttemptResponse,
  QuizV2Attempt,
} from '@/services/quiz-types';
import type { QuizV2StoreAccess } from './quiz-v2-store-access';

interface CreateQuizV2ExpiryActionInput {
  access: QuizV2StoreAccess;
  applyRecoveryResponse: (
    response: QuizActiveAttemptResponse,
    fallback: QuizV2Attempt
  ) => Promise<void>;
  getLifecycleEpoch: () => number;
  nextLifecycleEpoch: () => number;
}

export function createQuizV2ExpiryAction({
  access,
  applyRecoveryResponse,
  getLifecycleEpoch,
  nextLifecycleEpoch,
}: CreateQuizV2ExpiryActionInput) {
  let expiryInFlightGeneration: number | null = null;

  return async (reconciler: () => Promise<QuizActiveAttemptResponse>) => {
    const attempt = access.get().v2Attempt;
    const generation = access.getGeneration();
    if (
      expiryInFlightGeneration === generation ||
      !attempt ||
      !['question', 'submitting'].includes(access.get().status)
    )
      return;
    expiryInFlightGeneration = generation;
    const expiryEpoch = nextLifecycleEpoch();
    // Invalidate answer taps immediately while the authoritative expiry
    // reconciliation is in flight. Without this transition, a tap can start
    // a submission after the deadline and race the terminal response back to
    // the question state with no attempt left to render.
    access.set({ error: null, expiryRetryable: false, status: 'submitting' });
    try {
      const response = await reconciler();
      if (
        generation !== access.getGeneration() ||
        expiryEpoch !== getLifecycleEpoch()
      )
        return;
      await applyRecoveryResponse(response, attempt);
    } catch (error) {
      if (generation === access.getGeneration())
        access.set({
          expiryRetryable: true,
          status: 'question',
          error: access.getMessage(error),
        });
    } finally {
      if (expiryInFlightGeneration === generation)
        expiryInFlightGeneration = null;
    }
  };
}
