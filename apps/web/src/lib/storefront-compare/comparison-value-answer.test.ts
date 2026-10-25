import { describe, expect, it } from 'vitest';
import { buildComparisonValueAnswer } from './comparison-value-answer';

describe('buildComparisonValueAnswer', () => {
  it('states parity and unknown price without inventing savings or superiority', () => {
    expect(
      buildComparisonValueAnswer(
        { name: 'A', price: 66000 },
        { name: 'B', price: 66000 },
        'NGN',
        'en-NG'
      )
    ).toContain('same');
    expect(
      buildComparisonValueAnswer(
        { name: 'A', price: 0 },
        { name: 'B', price: 90000 },
        'NGN',
        'en-NG'
      )
    ).toContain('undetermined');
    const answer = buildComparisonValueAnswer(
      { name: 'A', price: 803000, condition: 'Used' },
      { name: 'B', price: 900000, condition: 'New' },
      'NGN',
      'en-NG'
    );
    expect(answer).toContain('A has the lower');
    expect(answer).toContain('different conditions');
    expect(answer).not.toContain('advantages');
  });
  it('keeps savings direction correct when the right listing is cheaper', () => {
    const answer = buildComparisonValueAnswer(
      { name: 'A', price: 200 },
      { name: 'B', price: 125 },
      'USD',
      'en-US'
    );
    expect(answer).toContain('B has the lower starting price by $75');
    expect(answer).toContain('different configurations');
  });
  it.each([
    null,
    undefined,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('does not calculate value from an invalid offer %s', (price) => {
    expect(
      buildComparisonValueAnswer(
        { name: 'A', price },
        { name: 'B', price: 10 },
        'USD',
        'en-US'
      )
    ).toContain('Value is undetermined');
  });
});
