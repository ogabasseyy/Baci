import { describe, expect, it } from 'vitest';
import { addCalendarMonthsClamped } from './add-calendar-months-clamped';

describe('addCalendarMonthsClamped', () => {
  it('clamps month-end forward instead of overflowing into March', () => {
    // Arrange & Act
    const matured = addCalendarMonthsClamped(
      new Date('2025-08-31T00:00:00.000Z'),
      6
    );

    // Assert: end of February 2026 in Lagos terms.
    expect(matured.getUTCFullYear()).toBe(2026);
    expect(matured.getUTCMonth()).toBe(1);
  });
});
