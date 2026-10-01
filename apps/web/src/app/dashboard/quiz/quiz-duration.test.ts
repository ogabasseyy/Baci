import { getSuggestedQuizLiveWindowSeconds } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import { suggestedQuizDuration } from './quiz-duration';

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

  it('floors test quizzes at per-question seconds', () => {
    expect(suggestedQuizDuration('test', 10, 30)).toBe(300);
    expect(suggestedQuizDuration('test', 0, 30)).toBe(30);
  });
});
