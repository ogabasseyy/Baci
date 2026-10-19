import { selectPreferredOrderPaymentAccount } from '@baci/shared';
import { describe, expect, it } from 'vitest';

describe('payment reminder account selection', () => {
  it('uses an active fallback instead of an expired Paystack alias', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        {
          account_name: 'Expired Paystack',
          account_number: '1111111111',
          assigned_at: '2026-08-25T10:00:00.000Z',
          bank_name: 'Paystack Bank',
          expires_at: '2026-08-25T11:30:00.000Z',
          provider: 'paystack',
        },
        {
          account_name: 'Manual confirmation',
          account_number: '2222222222',
          bank_name: 'Sterling Bank',
          provider: 'manual',
        },
      ],
      new Date('2026-08-25T12:00:00.000Z')
    );

    expect(selected?.account_number).toBe('2222222222');
  });
});
