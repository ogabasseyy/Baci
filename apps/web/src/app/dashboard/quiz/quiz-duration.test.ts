import { getSuggestedQuizLiveWindowSeconds } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import {
  QUIZ_TEST_MIN_SUGGESTED_WINDOW_SECONDS,
  suggestedQuizDuration,
} from './quiz-duration';

describe('suggestedQuizDuration', () => {
  it('delegates live quizzes with questions to the shared window suggestion', () => {
    expect(suggestedQuizDuration('live', 10, 30)).toBe(
      getSuggestedQuizLiveWindowSeconds(10, 30)
    );
  });

  it('falls back to a floor of per-question seconds without live questions', () => {
    expect(suggestedQuizDuration('live', 0, 30)).toBe(30);
    expect(suggestedQuizDuration('live', -2, 30)).toBe(30);
  });

  it('keeps long test quizzes at their full play time', () => {
    expect(suggestedQuizDuration('test', 40, 30)).toBe(1200);
  });

  describe('bugfix: immediate test quiz closed before the merchant could play', () => {
    it('suggests at least 15 minutes when play time is only 20 seconds', () => {
      expect(suggestedQuizDuration('test', 2, 10)).toBe(
        QUIZ_TEST_MIN_SUGGESTED_WINDOW_SECONDS
      );
      expect(QUIZ_TEST_MIN_SUGGESTED_WINDOW_SECONDS).toBe(900);
    });

    it('applies the same floor without generated questions', () => {
      expect(suggestedQuizDuration('test', 0, 30)).toBe(900);
    });
  });
});
