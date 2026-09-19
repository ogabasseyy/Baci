import { describe, expect, it } from 'vitest';
import { maturityStatus } from './plan-maturity-status';

describe('maturityStatus', () => {
  it('reports active before six months and grace within thirty days after', () => {
    // Arrange
    const activatedAt = new Date('2026-01-15T00:00:00.000Z');

    // Act & Assert
    expect(
      maturityStatus(activatedAt, new Date('2026-06-01T00:00:00.000Z'))
    ).toBe('active');
    expect(
      maturityStatus(activatedAt, new Date('2026-07-20T00:00:00.000Z'))
    ).toBe('grace');
    expect(
      maturityStatus(activatedAt, new Date('2026-09-01T00:00:00.000Z'))
    ).toBe('review-required');
  });

  it('fails closed on an invalid comparison date', () => {
    // Arrange & Act & Assert: an invalid now must throw rather than
    // silently move the plan into manual review.
    expect(() =>
      maturityStatus(
        new Date('2026-01-15T00:00:00.000Z'),
        new Date('not-a-date')
      )
    ).toThrow(RangeError);
  });
});

