import { describe, expect, it } from 'vitest';
import {
  assertKobo,
  assertPositiveKobo,
  assertValidDate,
} from './kobo-validators';

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

describe('assertPositiveKobo', () => {
  it('accepts positive safe integers and rejects zero', () => {
    // Arrange & Act & Assert
    expect(() => assertPositiveKobo(1, 'price')).not.toThrow();
    expect(() => assertPositiveKobo(0, 'price')).toThrow(RangeError);
    expect(() => assertPositiveKobo(-5, 'price')).toThrow(RangeError);
  });
});

describe('assertValidDate', () => {
  it('accepts valid dates and rejects invalid ones', () => {
    // Arrange & Act & Assert
    expect(() =>
      assertValidDate(new Date('2026-09-01T00:00:00.000Z'), 'when')
    ).not.toThrow();
    expect(() => assertValidDate(new Date('not-a-date'), 'when')).toThrow(
      RangeError
    );
  });
});
