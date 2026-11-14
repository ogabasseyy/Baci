import { describe, expect, it } from 'vitest';
import { isMajorAmountRepresentable } from './is-major-amount-representable';

describe('isMajorAmountRepresentable', () => {
  it('uses each currency minor-unit exponent without binary float false negatives', () => {
    expect(isMajorAmountRepresentable(1.001, 'KWD')).toBe(true);
    expect(isMajorAmountRepresentable(1.5, 'JPY')).toBe(false);
    expect(isMajorAmountRepresentable(1, 'JPY')).toBe(true);
    expect(isMajorAmountRepresentable(1.001, 'NGN')).toBe(false);
  });
});
