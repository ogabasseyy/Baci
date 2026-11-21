import { describe, expect, it } from 'vitest';
import { formatInsightDuration } from './insights-format';

describe('formatInsightDuration', () => {
  it.each([
    [null, '—'],
    [45, '45s'],
    [45.6, '46s'],
    [720, '12 min'],
    [3599, '59 min'],
    [3600, '1 h'],
    [12_000, '3 h 20 min'],
    [187_200, '2 d 4 h'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatInsightDuration(input)).toBe(expected);
  });
});
