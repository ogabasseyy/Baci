import { describe, expect, it } from 'vitest';
import { assertValidDate } from './assert-valid-date';

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
