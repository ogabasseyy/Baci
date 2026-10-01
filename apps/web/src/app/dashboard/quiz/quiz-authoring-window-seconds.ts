import { getSuggestedQuizLiveWindowSeconds } from '@baci/shared';

/**
 * Resolve the auto-synced quiz window length in seconds. Live mode tracks
 * the shared suggested live window (expected play plus the documented
 * grace, whole minutes) so activation satisfies the launch timing bounds.
 * Other modes use raw expected play with a floor that keeps the defaulted
 * end after the start when no questions exist yet.
 */
export function resolveQuizAuthoringWindowSeconds({
  mode,
  questionCount,
  timePerQuestionSeconds,
}: {
  mode: 'test' | 'live';
  questionCount: number;
  timePerQuestionSeconds: number;
}): number {
  if (mode === 'live' && questionCount > 0) {
    return getSuggestedQuizLiveWindowSeconds(
      questionCount,
      timePerQuestionSeconds
    );
  }
  return Math.max(questionCount * timePerQuestionSeconds, 60);
}
