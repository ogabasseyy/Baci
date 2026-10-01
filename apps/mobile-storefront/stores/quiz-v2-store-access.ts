import type { QuizV2StoreState } from './quiz-recovery-envelope';

export interface QuizV2StoreAccess {
  get: () => QuizV2StoreState;
  getGeneration: () => number;
  getMessage: (error: unknown) => string;
  set: (state: Partial<QuizV2StoreState>) => void;
}
