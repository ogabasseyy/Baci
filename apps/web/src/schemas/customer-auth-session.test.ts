import { describe, expect, it } from 'vitest';
import { customerSessionResponseSchema } from './customer-auth-session';

describe('customerSessionResponseSchema', () => {
  it('accepts valid authenticated and anonymous payloads', () => {
    expect(
      customerSessionResponseSchema.safeParse({
        authenticated: true,
        user: { id: 'user-1', email: 'ada@example.com', role: 'customer' },
        customer: {
          id: 'cust-1',
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'ada@example.com',
        },
      }).success
    ).toBe(true);

    expect(
      customerSessionResponseSchema.safeParse({
        authenticated: false,
        user: null,
        customer: null,
      }).success
    ).toBe(true);
  });

  it('rejects empty identity objects missing required id fields', () => {
    expect(
      customerSessionResponseSchema.safeParse({
        authenticated: true,
        user: {},
        customer: {},
      }).success
    ).toBe(false);
  });
});
