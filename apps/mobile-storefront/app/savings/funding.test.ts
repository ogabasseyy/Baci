import { describe, expect, it } from '@jest/globals';
import { parseRequestedAmount } from './funding';

describe('parseRequestedAmount', () => {
  it('accepts positive decimal integers', () => {
    expect(parseRequestedAmount('20000')).toBe(20000);
    expect(parseRequestedAmount('007')).toBe(7);
  });

  it.each([
    ['0x10'],
    ['1e3'],
    ['  50  '],
    ['10.5'],
    ['-5'],
    [''],
    ['20,000'],
  ])('rejects non-decimal shape %s', (value) => {
    expect(parseRequestedAmount(value)).toBeNull();
  });

  it('rejects zero and unsafe integers', () => {
    expect(parseRequestedAmount('0')).toBeNull();
    expect(
      parseRequestedAmount(String(Number.MAX_SAFE_INTEGER + 1))
    ).toBeNull();
  });
});
