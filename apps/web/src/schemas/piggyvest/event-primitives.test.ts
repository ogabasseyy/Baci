import { describe, expect, it } from 'vitest';
import {
  isoDateTimeSchema,
  koboAmountSchema,
  nullableStringSchema,
} from './event-primitives';

describe('koboAmountSchema', () => {
  it('accepts zero and positive integer kobo', () => {
    // Arrange & Act & Assert
    expect(koboAmountSchema.safeParse(0).success).toBe(true);
    expect(koboAmountSchema.safeParse(1750000).success).toBe(true);
  });

  it('rejects fractional and negative amounts', () => {
    // Arrange & Act & Assert: money fields must stay integer kobo.
    expect(koboAmountSchema.safeParse(10.5).success).toBe(false);
    expect(koboAmountSchema.safeParse(-1).success).toBe(false);
  });
});

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

describe('nullableStringSchema', () => {
  it('accepts strings and explicit nulls', () => {
    // Arrange & Act & Assert
    expect(nullableStringSchema.safeParse('pvb-meta').success).toBe(true);
    expect(nullableStringSchema.safeParse(null).success).toBe(true);
  });

  it('rejects non-string values', () => {
    // Arrange & Act & Assert
    expect(nullableStringSchema.safeParse(42).success).toBe(false);
  });
});
