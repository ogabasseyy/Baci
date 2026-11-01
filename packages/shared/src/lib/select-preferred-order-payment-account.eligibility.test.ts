import { describe, expect, it } from 'vitest';
import { selectPreferredOrderPaymentAccount } from './select-preferred-order-payment-account';

const NOW = new Date('2026-08-24T12:00:00.000Z');

const korapay = (overrides: Record<string, unknown> = {}) => ({
  account_name: 'Merchant',
  account_number: '5555555555',
  assigned_at: '2026-08-24T11:00:00.000Z',
  bank_name: 'Korapay',
  created_at: '2026-08-24T11:00:00.000Z',
  expires_at: null,
  provider: 'korapay',
  ...overrides,
});

describe('selectPreferredOrderPaymentAccount non-Paystack eligibility', () => {
  it('rejects a legacy-untrusted non-Paystack row like the sender filter', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        korapay({
          account_number: '5555555555',
          created_at: '2026-08-24T11:30:00.000Z',
          assignment_customer_email_source: 'legacy_untrusted',
        }),
        korapay({ account_number: '4444444444' }),
      ],
      NOW
    );

    expect(selected?.account_number).toBe('4444444444');
  });

  it('rejects a future-assigned non-Paystack row like the sender filter', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        korapay({
          account_number: '5555555555',
          assigned_at: '2026-08-24T13:00:00.000Z',
          created_at: '2026-08-24T13:00:00.000Z',
        }),
        korapay({ account_number: '4444444444' }),
      ],
      NOW
    );

    expect(selected?.account_number).toBe('4444444444');
  });

  it('rejects an expired non-Paystack row at exact expiry for live reads', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        korapay({
          account_number: '5555555555',
          created_at: '2026-08-24T11:30:00.000Z',
          expires_at: '2026-08-24T11:45:00.000Z',
        }),
        korapay({ account_number: '4444444444' }),
      ],
      NOW
    );

    expect(selected?.account_number).toBe('4444444444');
  });

  it('keeps an expired non-Paystack row for a paid historical document', () => {
    const selected = selectPreferredOrderPaymentAccount(
      [
        korapay({
          expires_at: '2026-08-24T11:45:00.000Z',
        }),
      ],
      NOW,
      { allowExpiredPaystackAccount: true }
    );

    expect(selected?.account_number).toBe('5555555555');
  });

  it('reads an explicit expiry through the sender delivery buffer when passed', () => {
    const rows = [
      korapay({
        expires_at: '2026-08-24T12:10:00.000Z',
      }),
    ];

    // Live reads use exact expiry: still valid at noon.
    expect(selectPreferredOrderPaymentAccount(rows, NOW)?.account_number).toBe(
      '5555555555'
    );
    // The email sender buffers expiring rows: expiring within 15 minutes
    // reads as expired, matching the database pre-filter and the RPC.
    expect(
      selectPreferredOrderPaymentAccount(rows, NOW, {
        expiryBufferMs: 15 * 60 * 1000,
      })
    ).toBeNull();
  });

  it('keeps a non-Paystack row without an explicit expiry', () => {
    const selected = selectPreferredOrderPaymentAccount([korapay()], NOW);

    expect(selected?.account_number).toBe('5555555555');
  });
});
