import { describe, expect, it } from 'vitest';
import { koboAmountSchema } from './kobo-amount-schema';

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
