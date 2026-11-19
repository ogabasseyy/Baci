import { describe, expect, it } from 'vitest';
import { deviceGradingAiResultSchema } from './device-grading';

const valid = {
  model: 'iPhone 13 Pro',
  grade: 'Good',
  observations: ['Minor frame scratches'],
};

describe('deviceGradingAiResultSchema', () => {
  it('accepts a well-formed answer and trims text', () => {
    expect(
      deviceGradingAiResultSchema.parse({
        ...valid,
        model: '  iPhone 13 Pro ',
        observations: [' Minor frame scratches '],
      })
    ).toEqual(valid);
  });

  it('defaults missing observations to an empty list and drops extra keys', () => {
    expect(
      deviceGradingAiResultSchema.parse({
        model: 'iPhone 13 Pro',
        grade: 'Poor',
        confidence: 88,
      })
    ).toEqual({ model: 'iPhone 13 Pro', grade: 'Poor', observations: [] });
  });

  it.each([
    ['a grade outside the four allowed', { ...valid, grade: 'Mint' }],
    ['a missing model', { grade: 'Good', observations: [] }],
    ['a one-character model', { ...valid, model: 'X' }],
    ['a blank model', { ...valid, model: '   ' }],
    ['a model above 80 characters', { ...valid, model: 'a'.repeat(81) }],
    [
      'more than five observations',
      { ...valid, observations: Array(6).fill('x') },
    ],
    ['an empty observation', { ...valid, observations: [' '] }],
    [
      'an observation above 200 characters',
      { ...valid, observations: ['a'.repeat(201)] },
    ],
    ['a non-object answer', 'iPhone 13 Pro'],
  ])('rejects %s', (_label, answer) => {
    expect(deviceGradingAiResultSchema.safeParse(answer).success).toBe(false);
  });

  it('accepts the length boundaries', () => {
    expect(
      deviceGradingAiResultSchema.safeParse({
        model: 'a'.repeat(80),
        grade: 'Excellent',
        observations: Array(5).fill('a'.repeat(200)),
      }).success
    ).toBe(true);
  });
});
