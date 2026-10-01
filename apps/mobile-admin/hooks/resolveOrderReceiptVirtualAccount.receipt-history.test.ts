import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeOrder,
  resolveReceiptVirtualAccount as resolveOrderReceiptVirtualAccount,
  setupReceiptResolverTest,
  teardownReceiptResolverTest,
} from './resolveOrderReceiptVirtualAccount.test-support';

describe('resolveOrderReceiptVirtualAccount receipt history', () => {
  beforeEach(setupReceiptResolverTest);
  afterEach(teardownReceiptResolverTest);

  it('keeps a paid Paystack account after terminal expiry for receipt history', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T12:01:00.000Z'));
    try {
      const account = await resolveOrderReceiptVirtualAccount({
        merchant: null,
        order: makeOrder({
          payment_status: 'paid',
          virtual_account: {
            account_name: 'Baci',
            account_number: '1234567890',
            assigned_at: '2026-05-22T10:00:00.000Z',
            bank_name: 'Bank',
            expires_at: '2026-05-22T12:00:00.000Z',
            provider: 'paystack',
          },
        }),
      });

      expect(account).toEqual({
        account_name: 'Baci',
        account_number: '1234567890',
        bank_name: 'Bank',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show an untrusted expired Paystack alias on a paid receipt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T12:01:00.000Z'));
    try {
      const account = await resolveOrderReceiptVirtualAccount({
        merchant: null,
        order: makeOrder({
          payment_status: 'paid',
          virtual_account: {
            account_name: 'Legacy',
            account_number: '1234567890',
            assignment_customer_email_source: 'legacy_untrusted',
            assigned_at: '2026-05-22T10:00:00.000Z',
            bank_name: 'Bank',
            expires_at: '2026-05-22T12:00:00.000Z',
            provider: 'paystack',
          },
        }),
      });

      expect(account).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a newly assigned Paystack account when the device clock trails the server', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T12:00:00.000Z'));
    try {
      const account = await resolveOrderReceiptVirtualAccount({
        merchant: null,
        order: makeOrder({
          payment_status: 'paid',
          virtual_account: {
            account_name: 'Baci',
            account_number: '1234567890',
            assigned_at: '2026-05-22T12:03:00.000Z',
            bank_name: 'Bank',
            expires_at: '2026-05-22T13:03:00.000Z',
            provider: 'paystack',
          },
        }),
      });

      expect(account).toEqual({
        account_name: 'Baci',
        account_number: '1234567890',
        bank_name: 'Bank',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
