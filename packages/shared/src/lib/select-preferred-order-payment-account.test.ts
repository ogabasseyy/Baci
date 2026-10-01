import { describe, expect, it } from 'vitest';
import { selectPreferredOrderPaymentAccount } from './select-preferred-order-payment-account';

const account = (
  provider: string,
  accountNumber: string,
  createdAt: string
) => ({
  account_name: 'Merchant',
  account_number: accountNumber,
  bank_name: 'Bank',
  created_at: createdAt,
  provider,
});

describe('selectPreferredOrderPaymentAccount', () => {
  it('prefers Paystack when legacy provider rows coexist', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        account('korapay', '1111111111', '2026-08-24T12:00:00.000Z'),
        account('paystack', '2222222222', '2026-08-24T11:00:00.000Z'),
      ],
      new Date('2026-08-24T11:30:00.000Z')
    );

    expect(selected?.account_number).toBe('2222222222');
  });

  it('uses the newest non-Paystack row when no Paystack row exists', () => {
    const selected = selectPreferredOrderPaymentAccount([
      account('korapay', '1111111111', '2026-08-24T11:00:00.000Z'),
      account('korapay', '2222222222', '2026-08-24T12:00:00.000Z'),
    ]);

    expect(selected?.account_number).toBe('2222222222');
  });

  it('returns null for an empty account list', () => {
    expect(selectPreferredOrderPaymentAccount([])).toBeNull();
  });

  it('uses a legacy account instead of an expired Paystack alias', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        {
          account_name: 'Expired Paystack',
          account_number: '1111111111',
          assigned_at: '2026-08-24T08:00:00.000Z',
          bank_name: 'Paystack Bank',
          expires_at: '2026-08-24T09:30:00.000Z',
          provider: 'paystack',
        },
        {
          account_name: 'Legacy',
          account_number: '2222222222',
          bank_name: 'Legacy Bank',
          provider: 'korapay',
        },
      ],
      new Date('2026-08-24T10:00:00.000Z')
    );

    expect(selected?.account_number).toBe('2222222222');
  });

  it('keeps a just-assigned Paystack account visible on a slow device clock', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        {
          ...account('paystack', '2222222222', '2026-08-24T12:00:00.000Z'),
          assigned_at: '2026-08-24T12:00:00.000Z',
          expires_at: '2026-08-24T13:30:00.000Z',
        },
      ],
      new Date('2026-08-24T11:58:00.000Z'),
      { allowDeviceClockSkew: true }
    );

    expect(selected?.account_number).toBe('2222222222');
  });

  it('keeps server selection strict when assignment is still in the future', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        {
          ...account('paystack', '2222222222', '2026-08-24T12:00:00.000Z'),
          assigned_at: '2026-08-24T12:00:00.000Z',
          expires_at: '2026-08-24T13:30:00.000Z',
        },
      ],
      new Date('2026-08-24T11:58:00.000Z')
    );

    expect(selected).toBeNull();
  });

  it('stops displaying a Paystack account at its explicit expiry', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        {
          ...account('paystack', '2222222222', '2026-08-24T12:00:00.000Z'),
          assigned_at: '2026-08-24T12:00:00.000Z',
          expires_at: '2026-08-24T13:30:00.000Z',
        },
      ],
      new Date('2026-08-24T13:32:00.000Z')
    );

    expect(selected).toBeNull();
  });

  it('keeps an expired Paystack account for a paid historical document', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        {
          ...account('paystack', '2222222222', '2026-08-24T12:00:00.000Z'),
          assigned_at: '2026-08-24T12:00:00.000Z',
          expires_at: '2026-08-24T13:30:00.000Z',
        },
      ],
      new Date('2026-08-24T13:32:00.000Z'),
      { allowExpiredPaystackAccount: true }
    );

    expect(selected?.account_number).toBe('2222222222');
  });

  it('selects the paid DVA from transaction metadata over a newer historical alias', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        {
          ...account('paystack', '1111111111', '2026-08-24T12:00:00.000Z'),
          assigned_at: '2026-08-24T12:00:00.000Z',
          expires_at: '2026-08-24T13:30:00.000Z',
        },
        {
          ...account('paystack', '2222222222', '2026-08-24T13:00:00.000Z'),
          assigned_at: '2026-08-24T13:00:00.000Z',
          expires_at: '2026-08-24T14:30:00.000Z',
        },
      ],
      new Date('2026-08-24T15:00:00.000Z'),
      {
        allowExpiredPaystackAccount: true,
        preferredPaystackAccountNumber: '1111111111',
      }
    );

    expect(selected?.account_number).toBe('1111111111');
  });

  it('does not use historical mode for a future Paystack assignment', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        {
          ...account('paystack', '2222222222', '2026-08-24T12:00:00.000Z'),
          assigned_at: '2026-08-24T14:00:00.000Z',
          expires_at: '2026-08-24T15:30:00.000Z',
        },
      ],
      new Date('2026-08-24T13:32:00.000Z'),
      { allowExpiredPaystackAccount: true }
    );

    expect(selected).toBeNull();
  });

  it('does not use historical mode for a legacy-untrusted alias', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        {
          ...account('paystack', '2222222222', '2026-08-24T12:00:00.000Z'),
          assignment_customer_email_source: 'legacy_untrusted',
          assigned_at: '2026-08-24T12:00:00.000Z',
          expires_at: '2026-08-24T13:30:00.000Z',
        },
      ],
      new Date('2026-08-24T13:32:00.000Z'),
      { allowExpiredPaystackAccount: true }
    );

    expect(selected).toBeNull();
  });

  it('preserves a legacy Paystack row without an explicit expiry when requested', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        {
          ...account('paystack', '2222222222', '2026-08-01T12:00:00.000Z'),
          assigned_at: '2026-08-01T12:00:00.000Z',
          expires_at: null,
        },
      ],
      new Date('2026-08-24T13:32:00.000Z'),
      { allowMissingExpiryPaystackAccount: true }
    );

    expect(selected?.account_number).toBe('2222222222');
  });

  it('does not display a legacy-untrusted Paystack account', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        {
          ...account('paystack', '4444444444', '2026-08-24T12:00:00.000Z'),
          assignment_customer_email_source: 'legacy_untrusted',
          assigned_at: '2026-08-24T12:00:00.000Z',
          expires_at: '2026-09-07T12:00:00.000Z',
        },
      ],
      new Date('2026-08-24T14:00:00.000Z')
    );

    expect(selected).toBeNull();
  });

  it('keeps an invoice Paystack account visible through its explicit expiry', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        {
          ...account('paystack', '3333333333', '2026-08-24T12:00:00.000Z'),
          assigned_at: '2026-08-24T12:00:00.000Z',
          expires_at: '2026-09-07T12:00:00.000Z',
        },
      ],
      new Date('2026-08-24T14:00:00.000Z')
    );

    expect(selected?.account_number).toBe('3333333333');
  });

  it('rejects a just-retired Paystack account without expiry grace', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        {
          ...account('paystack', '1111111111', '2026-08-24T12:00:00.000Z'),
          assigned_at: '2026-08-24T12:00:00.000Z',
          expires_at: '2026-08-24T12:01:00.000Z',
        },
        account('korapay', '2222222222', '2026-08-24T11:00:00.000Z'),
      ],
      new Date('2026-08-24T12:02:00.000Z')
    );

    expect(selected?.account_number).toBe('2222222222');
  });
});
