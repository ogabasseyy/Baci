import { describe, expect, it } from 'vitest';
import { QUIZ_AUTHORING_MAX_DURATION_SECONDS } from './quiz-authoring-timing-limits';

describe('quiz authoring timing limits', () => {
  it('caps total duration at two hours', () => {
    expect(QUIZ_AUTHORING_MAX_DURATION_SECONDS).toBe(7200);
  });

  it('stays aligned to whole minutes for the minute-based input', () => {
    expect(QUIZ_AUTHORING_MAX_DURATION_SECONDS % 60).toBe(0);
  });
});
