import { create } from 'zustand';
import { getFriendlyQuizErrorMessage } from '@/services/quiz-error-messages';
import type {
  QuizAttempt,
  QuizEvent,
  QuizIntegrityTier,
  QuizResult,
  QuizV2Attempt,
  QuizV2Result,
} from '@/services/quiz-types';
import { QuizServiceError } from '@/services/quiz-types';
import type {
  QuizTerminalContext,
  QuizV2LifecycleStatus,
  QuizV2StoreActions,
} from './quiz-recovery-envelope';
import {
  clearQuizRecoveryEnvelope,
  initialQuizV2State,
} from './quiz-recovery-envelope';
import { createQuizV2StoreActions } from './quiz-v2-store-actions';

export { QUIZ_RECONCILIATION_INTERVAL_MS } from './quiz-v2-store-actions';

type QuizStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'starting'
  | 'question'
  | 'submitting'
  | 'result'
  | 'error';

interface QuizStore extends QuizV2StoreActions {
  status: QuizStatus;
  events: QuizEvent[];
  selectedEventId: string | null;
  attempt: QuizAttempt | null;
  v2Attempt: QuizV2Attempt | null;
  attemptIntegrityTier: QuizIntegrityTier | null;
  expiryRetryable: boolean;
  selectedOptionId: string | null;
  lockedOptionId: string | null;
  startRequestId: string | null;
  recoveryUserId: string | null;
  result: QuizResult | null;
  v2Result: QuizV2Result | null;
  v2LifecycleStatus: QuizV2LifecycleStatus;
  terminalContext: QuizTerminalContext | null;
  error: string | null;
  loadEvents: (loader: () => Promise<QuizEvent[]>) => Promise<void>;
  startEvent: (
    eventId: string,
    tier: QuizIntegrityTier,
    starter: () => Promise<QuizAttempt>
  ) => Promise<void>;
  selectAnswer: (optionId: string) => void;
  submitSelectedAnswer: (submitter: () => Promise<QuizResult>) => Promise<void>;
  forfeitAnswer: (
    submitter: () => Promise<QuizResult>,
    retryOptionId?: string
  ) => Promise<void>;
  setError: (message: string) => void;
  dismissRecovery: () => Promise<void>;
  reset: () => void;
  showLobby: () => void;
  resetForAccountChange: () => void;
}

const initialState = {
  status: 'idle' as const,
  events: [],
  selectedEventId: null,
  attempt: null,
  ...initialQuizV2State,
  attemptIntegrityTier: null,
  selectedOptionId: null,
  result: null,
  error: null,
};

function getMessage(error: unknown): string {
  if (error instanceof QuizServiceError) {
    return getFriendlyQuizErrorMessage(error, 'Quiz request failed');
  }
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  let serialized: string;
  try {
    serialized = JSON.stringify(error);
  } catch {
    serialized = String(error);
  }
  const runtimeType =
    error && typeof error === 'object'
      ? ((error as { constructor?: { name?: string } }).constructor?.name ??
        'Object')
      : typeof error;
  return `Quiz action failed (${runtimeType}: ${serialized})`;
}

export const useQuizStore = create<QuizStore>((set, get) => {
  let generation = 0;

  const performLegacySubmit = async (submitter: () => Promise<QuizResult>) => {
    if (get().status === 'submitting') return;
    const currentAttempt = get().attempt;
    if (!currentAttempt) {
      set({
        status: 'ready',
        error: 'No active quiz attempt. Start a quiz to continue.',
      });
      return;
    }
    const currentGeneration = generation;
    set({ status: 'submitting', error: null });
    try {
      const result = await submitter();
      if (generation !== currentGeneration) return;
      if (
        result.status === 'in_progress' &&
        result.question &&
        currentAttempt
      ) {
        set({
          status: 'question',
          attempt: { ...currentAttempt, question: result.question },
          selectedOptionId: null,
        });
      } else if (result.status === 'completed') {
        set({ status: 'result', result, error: null });
      } else
        set({
          status: 'error',
          error: 'Quiz response did not include the next question.',
        });
    } catch (error) {
      if (generation === currentGeneration)
        set({
          status: currentAttempt ? 'question' : 'ready',
          error: getMessage(error),
        });
    }
  };

  const v2Actions = createQuizV2StoreActions({
    get,
    getGeneration: () => generation,
    getMessage,
    set,
  });

  return {
    ...initialState,
    ...v2Actions,
    loadEvents: async (loader) => {
      const currentGeneration = generation;
      set({ status: 'loading', error: null });
      try {
        const events = await loader();
        if (generation !== currentGeneration) return;
        set({ status: 'ready', events });
      } catch (error) {
        if (generation !== currentGeneration) return;
        set({ status: 'ready', error: getMessage(error) });
      }
    },
    startEvent: async (eventId, tier, starter) => {
      if (get().status === 'starting' || get().status === 'submitting') return;
      const currentGeneration = generation;
      set({
        status: 'starting',
        attempt: null,
        selectedEventId: eventId,
        attemptIntegrityTier: tier,
        selectedOptionId: null,
        result: null,
        error: null,
      });
      try {
        const attempt = await starter();
        if (generation === currentGeneration)
          set({ status: 'question', attempt });
      } catch (error) {
        if (generation === currentGeneration)
          set({ status: 'ready', error: getMessage(error) });
      }
    },
    selectAnswer: (optionId) => {
      if (get().status === 'submitting') {
        set({ error: 'Answer is already being submitted.' });
        return;
      }
      if (get().status !== 'question')
        return set({ error: 'Cannot select answer outside question phase.' });
      set({ selectedOptionId: optionId, error: null });
    },
    submitSelectedAnswer: async (submitter) =>
      get().selectedOptionId
        ? performLegacySubmit(submitter)
        : set({ error: 'Select an answer before submitting.' }),
    forfeitAnswer: async (submitter, retryOptionId) => {
      if (!get().attempt) return;
      if (retryOptionId && !get().selectedOptionId)
        set({ selectedOptionId: retryOptionId });
      await performLegacySubmit(submitter);
    },
    setError: (message) => set({ status: 'error', error: message }),
    dismissRecovery: async () => {
      const state = get();
      if (!state.recoveryUserId || !state.selectedEventId) return;
      await clearQuizRecoveryEnvelope(
        state.recoveryUserId,
        state.selectedEventId
      ).catch(() => undefined);
    },
    reset: () => {
      const state = get();
      generation += 1;
      const retainRecovery =
        Boolean(state.terminalContext?.attemptId) &&
        (state.v2LifecycleStatus === 'pending_results' ||
          (state.v2LifecycleStatus === 'final' &&
            state.v2Result?.availability === 'final' &&
            Boolean(state.v2Result.prizeClaim)));
      if (state.recoveryUserId && state.selectedEventId && !retainRecovery)
        void clearQuizRecoveryEnvelope(
          state.recoveryUserId,
          state.selectedEventId
        ).catch(() => undefined);
      set(initialState);
    },
    resetForAccountChange: () => {
      generation += 1;
      set(initialState);
    },
    showLobby: () => {
      const state = get();
      // Legacy requests cannot be recovered if their response is discarded.
      if (
        !state.v2Attempt &&
        !state.startRequestId &&
        (state.status === 'starting' || state.status === 'submitting')
      )
        return;
      generation += 1;
      // Keep the attempt and persisted request ID for explicit Resume.
      set({ status: 'ready', error: null });
    },
  };
});
