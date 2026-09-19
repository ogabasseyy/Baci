import { describe, expect, it } from 'vitest';
import { isoDateTimeSchema } from './iso-datetime-schema';

describe('isoDateTimeSchema', () => {
  it('accepts datetimes with an explicit offset', () => {
    // Arrange & Act & Assert
    expect(
      isoDateTimeSchema.safeParse('2026-09-15T10:12:00.000Z').success
    ).toBe(true);
  });

  it('rejects date-only values without time or offset', () => {
    // Arrange & Act & Assert
    expect(isoDateTimeSchema.safeParse('2026-09-15').success).toBe(false);
  });
});
