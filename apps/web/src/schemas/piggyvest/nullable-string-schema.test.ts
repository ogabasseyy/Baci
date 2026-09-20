import { describe, expect, it } from 'vitest';
import { nullableStringSchema } from './nullable-string-schema';

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
