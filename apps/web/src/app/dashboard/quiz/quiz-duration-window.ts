import {
  getQuizWindowBounds,
  getSuggestedQuizLiveWindowSeconds,
} from '@baci/shared/constants';
import { clampNumber } from './quiz-admin-actions';

interface QuizDurationWindow {
  totalQuizDurationSeconds: number;
  windowBounds: { maximumSeconds: number | null; minimumSeconds: number };
}

export function getQuizDurationWindow({
  expectedPlaySeconds,
  mode,
  questionCount,
  requestedTotalDurationSeconds,
  timePerQuestionSeconds,
}: {
  expectedPlaySeconds: number;
  mode: 'test' | 'live';
  questionCount: number;
  requestedTotalDurationSeconds: number | null;
  timePerQuestionSeconds: number;
}): QuizDurationWindow {
  const windowInputsValid =
    Number.isInteger(questionCount) &&
    questionCount > 0 &&
    Number.isInteger(timePerQuestionSeconds) &&
    timePerQuestionSeconds > 0;
  const windowBounds = windowInputsValid
    ? getQuizWindowBounds(mode, questionCount, timePerQuestionSeconds)
    : { maximumSeconds: null as number | null, minimumSeconds: 0 };
  const defaultTotalDurationSeconds =
    mode === 'live' && windowInputsValid
      ? getSuggestedQuizLiveWindowSeconds(questionCount, timePerQuestionSeconds)
      : expectedPlaySeconds;
  const desiredTotalDurationSeconds =
    requestedTotalDurationSeconds ?? defaultTotalDurationSeconds;
  return {
    totalQuizDurationSeconds: clampNumber(
      desiredTotalDurationSeconds,
      windowBounds.minimumSeconds,
      windowBounds.maximumSeconds ?? desiredTotalDurationSeconds
    ),
    windowBounds,
  };
}
