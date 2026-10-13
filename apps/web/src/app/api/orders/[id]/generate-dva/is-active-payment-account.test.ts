import { describe, expect, it } from 'vitest';
import { isActivePaymentAccount } from './is-active-payment-account';

describe('isActivePaymentAccount', () => {
  it('keeps legacy providers active', () => {
    expect(isActivePaymentAccount({ provider: 'moniepoint' })).toBe(true);
  });

  it('rejects legacy-untrusted Paystack accounts', () => {
    expect(
      isActivePaymentAccount({
        assignment_customer_email_source: 'legacy_untrusted',
        provider: 'paystack',
      })
    ).toBe(false);
  });

  it('honors the default assignment window when no expiry is persisted', () => {
    const assignedAt = new Date('2026-08-24T10:00:00.000Z');
    const account = {
      assigned_at: assignedAt.toISOString(),
      provider: 'paystack',
    };

    expect(
      isActivePaymentAccount(
        account,
        new Date(assignedAt.getTime() + 89 * 60 * 1000)
      )
    ).toBe(true);
    expect(
      isActivePaymentAccount(
        account,
        new Date(assignedAt.getTime() + 91 * 60 * 1000)
      )
    ).toBe(false);
  });

  it('honors an explicit expiry and rejects assignments from the future', () => {
    expect(
      isActivePaymentAccount(
        {
          assigned_at: '2026-08-24T12:00:00.000Z',
          expires_at: '2026-08-25T00:00:00.000Z',
          provider: 'paystack',
        },
        new Date('2026-08-24T11:59:00.000Z')
      )
    ).toBe(false);
    expect(
      isActivePaymentAccount(
        {
          assigned_at: '2026-08-24T10:00:00.000Z',
          expires_at: '2026-08-25T00:00:00.000Z',
          provider: 'paystack',
        },
        new Date('2026-08-24T12:00:00.000Z')
      )
    ).toBe(true);
  });
});
