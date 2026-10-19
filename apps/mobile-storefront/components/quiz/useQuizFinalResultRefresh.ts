import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import { fetchQuizResult } from '@/services/quiz-results';
import type { QuizV2Result } from '@/services/quiz-types';

interface UseQuizFinalResultRefreshInput {
  attemptId: string | null;
  enabled: boolean;
  expectedUserId: string | null;
  onResult: (result: QuizV2Result) => void;
}

/** Refreshes a terminal result when the player returns from checkout. */
export function useQuizFinalResultRefresh({
  attemptId,
  enabled,
  expectedUserId,
  onResult,
}: UseQuizFinalResultRefreshInput) {
  const hasFocused = useRef(false);
  const isFocused = useIsFocused();

  useEffect(() => {
    if (!isFocused) return;
    const shouldRefresh = hasFocused.current;
    hasFocused.current = true;
    if (!shouldRefresh || !enabled || !attemptId || !expectedUserId) return;

    let active = true;
    void fetchQuizResult({ attemptId, expectedUserId })
      .then((result) => {
        if (active && result.availability !== 'pending') onResult(result);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [attemptId, enabled, expectedUserId, isFocused, onResult]);
}
