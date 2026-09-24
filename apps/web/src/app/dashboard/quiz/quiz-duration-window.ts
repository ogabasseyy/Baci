import {
  getQuizWindowBounds,
  getSuggestedQuizLiveWindowSeconds,
  isQuizWindowSecondsAllowed,
  QUIZ_TEST_WINDOW_MAXIMUM_SECONDS,
} from '@baci/shared/constants';
import { clampNumber } from './quiz-admin-actions';

interface QuizDurationWindow {
  totalQuizDurationSeconds: number;
  windowBounds: { maximumSeconds: number; minimumSeconds: number };
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
  const sharedBounds = windowInputsValid
    ? getQuizWindowBounds(mode, questionCount, timePerQuestionSeconds)
    : null;
  const windowBounds = {
    maximumSeconds:
      sharedBounds?.maximumSeconds ?? QUIZ_TEST_WINDOW_MAXIMUM_SECONDS,
    minimumSeconds: sharedBounds?.minimumSeconds ?? 0,
  };
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
      windowBounds.maximumSeconds
    ),
    windowBounds,
  };
}

export function isScheduledQuizWindowValid({
  mode,
  questionCount,
  scheduledEnd,
  scheduledStart,
  timePerQuestionSeconds,
}: {
  mode: 'test' | 'live';
  questionCount: number;
  scheduledEnd: string;
  scheduledStart: string;
  timePerQuestionSeconds: number;
}): boolean {
  if (!scheduledStart || !scheduledEnd) return false;
  const windowSeconds =
    (Date.parse(scheduledEnd) - Date.parse(scheduledStart)) / 1000;
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return false;
  try {
    return isQuizWindowSecondsAllowed(
      mode,
      questionCount,
      timePerQuestionSeconds,
      windowSeconds
    );
  } catch {
    return false;
  }
}
