import { describe, expect, it } from 'vitest';
import { formatQuizDuration } from './quiz-format-duration';

describe('formatQuizDuration', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(formatQuizDuration(0)).toBe('0s');
    expect(formatQuizDuration(1)).toBe('1s');
    expect(formatQuizDuration(59)).toBe('59s');
  });

  it('formats exact minutes without a seconds part', () => {
    expect(formatQuizDuration(60)).toBe('1m');
    expect(formatQuizDuration(3600)).toBe('60m');
  });

  it('formats mixed minutes and seconds', () => {
    expect(formatQuizDuration(61)).toBe('1m 1s');
    expect(formatQuizDuration(125)).toBe('2m 5s');
  });
});
