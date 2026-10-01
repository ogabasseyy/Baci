import type { QuizV2Result } from '@/services/quiz-types';

export function resultLifecycle(result: QuizV2Result) {
  if (result.availability === 'pending') return 'pending_results' as const;
  if (
    result.availability === 'unavailable' &&
    result.reason === 'event_cancelled'
  )
    return 'event_cancelled' as const;
  return 'final' as const;
}
