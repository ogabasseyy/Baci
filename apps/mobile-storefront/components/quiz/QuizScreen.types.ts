import type { QuizIntegrityTier } from '@/services/quiz';
import type { QuizBackHandlerRef } from './useQuizBackHandler';

export interface QuizScreenProps {
  backHandlerRef?: QuizBackHandlerRef;
  integrityTier?: QuizIntegrityTier;
  locale?: string;
  onSignIn?: () => void;
}
