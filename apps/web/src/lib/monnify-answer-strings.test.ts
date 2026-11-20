import { describe, expect, it } from 'vitest';
import { joinMonnifyAnswerStrings } from './monnify-answer-strings';

describe('joinMonnifyAnswerStrings', () => {
  it('joins string values at any depth and leaves keys out', () => {
    expect(
      joinMonnifyAnswerStrings({
        responseMessage: 'Insufficient wallet balance',
        reference: 'BACI-REF-1',
        responseBody: { reason: 'vendReference=MFBP-1', items: ['a', 2] },
      })
    ).toBe('Insufficient wallet balance BACI-REF-1 vendReference=MFBP-1 a');
  });

  it.each([
    null,
    undefined,
    42,
    {},
  ])('returns an empty string for %j', (value) => {
    expect(joinMonnifyAnswerStrings(value)).toBe('');
  });
});
