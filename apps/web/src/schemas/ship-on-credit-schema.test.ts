import { describe, expect, it } from 'vitest';
import { shipOnCreditBodySchema } from './ship-on-credit-schema';

describe('shipOnCreditBodySchema', () => {
  it('accepts and trims credit notes', () => {
    expect(
      shipOnCreditBodySchema.parse({ credit_notes: '  Ship now  ' })
    ).toEqual({
      credit_notes: 'Ship now',
    });
  });

  it('rejects notes longer than 2000 characters', () => {
    expect(
      shipOnCreditBodySchema.safeParse({ notes: 'x'.repeat(2001) }).success
    ).toBe(false);
  });
});
