import { describe, expect, it } from 'vitest';
import { assertKobo } from './assert-kobo';

describe('assertKobo', () => {
  it('accepts zero and positive safe integers', () => {
    // Arrange & Act & Assert
    expect(() => assertKobo(0, 'amount')).not.toThrow();
    expect(() => assertKobo(Number.MAX_SAFE_INTEGER, 'amount')).not.toThrow();
  });

  it('rejects negative, fractional, and unsafe values', () => {
    // Arrange & Act & Assert
    expect(() => assertKobo(-1, 'amount')).toThrow(RangeError);
    expect(() => assertKobo(10.5, 'amount')).toThrow(RangeError);
    expect(() => assertKobo(Number.MAX_SAFE_INTEGER + 1, 'amount')).toThrow(
      RangeError
    );
  });
});
