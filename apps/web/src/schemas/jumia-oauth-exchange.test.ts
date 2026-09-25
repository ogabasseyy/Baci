import { describe, expect, it } from 'vitest';
import { jumiaOAuthExchangeSchema } from './jumia-oauth-exchange';

describe('jumiaOAuthExchangeSchema', () => {
  it('accepts a valid code and UUID ticket', () => {
    expect(
      jumiaOAuthExchangeSchema.safeParse({
        code: 'authorization-code',
        ticketId: '00000000-0000-4000-8000-000000000001',
      }).success
    ).toBe(true);
  });

  it('rejects empty codes, oversized codes, and invalid tickets', () => {
    expect(
      jumiaOAuthExchangeSchema.safeParse({ code: '', ticketId: 'invalid' })
        .success
    ).toBe(false);
    expect(
      jumiaOAuthExchangeSchema.safeParse({
        code: 'x'.repeat(2049),
        ticketId: '00000000-0000-4000-8000-000000000001',
      }).success
    ).toBe(false);
  });
});
