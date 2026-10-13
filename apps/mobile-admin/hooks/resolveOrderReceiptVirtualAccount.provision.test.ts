import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authenticate,
  makeOrder,
  receiptResolverTestMocks as mocks,
  okJson,
  resolveReceiptVirtualAccount as resolveOrderReceiptVirtualAccount,
  setupReceiptResolverTest,
  teardownReceiptResolverTest,
} from './resolveOrderReceiptVirtualAccount.test-support';

describe('resolveOrderReceiptVirtualAccount provisioning', () => {
  beforeEach(setupReceiptResolverTest);
  afterEach(teardownReceiptResolverTest);

  it('returns the existing virtual account for paid orders', async () => {
    const account = await resolveOrderReceiptVirtualAccount({
      merchant: null,
      order: makeOrder({
        amount_paid: 10000,
        balance: 0,
        payment_status: 'paid',
        virtual_account: {
          account_name: 'Baci',
          account_number: '1234567890',
          bank_name: 'Bank',
        },
      }),
    });

    expect(account).toEqual({
      account_name: 'Baci',
      account_number: '1234567890',
      bank_name: 'Bank',
    });
  });

  it('keeps a paid invoice account through its explicit expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T11:45:00.000Z'));
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

  it('falls back to the merchant bank account when no virtual account exists', async () => {
    authenticate();
    mocks.fetch.mockResolvedValue(okJson({ account_name: 'Baci Ltd' }));

    const account = await resolveOrderReceiptVirtualAccount({
      merchant: {
        bank_account_name: '',
        bank_account_number: '0123456789',
        bank_code: '044',
        business_name: 'Baci',
      },
      order: makeOrder(),
    });

    expect(account).toMatchObject({
      account_name: 'Baci Ltd',
      account_number: '0123456789',
    });
  });

  it('provisions automatic confirmation for an unpaid manual invoice', async () => {
    authenticate();
    mocks.fetch.mockResolvedValue(
      okJson({
        existing: false,
        success: true,
        virtualAccount: {
          account_name: 'Baci / Ada',
          account_number: '9876543210',
          bank_name: 'Paystack-Titan',
        },
      })
    );

    const account = await resolveOrderReceiptVirtualAccount({
      merchant: {
        bank_account_name: '',
        bank_account_number: '0123456789',
        bank_code: '044',
        business_name: 'Merchant',
      },
      order: makeOrder({ source: 'physical' }),
    });

    expect(account).toEqual({
      account_name: 'Baci / Ada',
      account_number: '9876543210',
      bank_name: 'Paystack-Titan',
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://example.com/api/orders/order-1/generate-dva',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
        }),
        method: 'POST',
        signal: expect.any(AbortSignal),
      })
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('revalidates an order Paystack account before using a staff terminal fallback', async () => {
    authenticate();
    mocks.fetch.mockResolvedValue(
      okJson({
        virtualAccount: {
          account_name: 'Baci / Ada',
          account_number: '9876543210',
          bank_name: 'Paystack-Titan',
        },
      })
    );

    const account = await resolveOrderReceiptVirtualAccount({
      merchant: null,
      order: makeOrder({
        staff_terminal: {
          account_name: 'Generic Terminal',
          account_number: '1111111111',
          bank_name: 'Terminal Bank',
        },
        virtual_account: {
          account_name: 'Cached Paystack',
          account_number: '9876543210',
          bank_name: 'Paystack-Titan',
          provider: 'paystack',
        },
      }),
    });

    expect(account).toEqual({
      account_name: 'Baci / Ada',
      account_number: '9876543210',
      bank_name: 'Paystack-Titan',
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://example.com/api/orders/order-1/generate-dva',
      expect.anything()
    );
  });

  it('does not advertise a cached Paystack account when the server rejects provisioning', async () => {
    authenticate();
    mocks.fetch.mockResolvedValue({ ok: false, status: 400 });

    const account = await resolveOrderReceiptVirtualAccount({
      merchant: {
        bank_account_name: 'Manual Account',
        bank_account_number: '0123456789',
        bank_code: '044',
        business_name: 'Merchant',
      },
      order: makeOrder({
        virtual_account: {
          account_name: 'Disabled Paystack',
          account_number: '9876543210',
          bank_name: 'Paystack-Titan',
          provider: 'paystack',
        },
      }),
    });

    expect(account).toMatchObject({
      account_name: 'Manual Account',
      account_number: '0123456789',
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://example.com/api/orders/order-1/generate-dva',
      expect.anything()
    );
  });

  it('does not provision Paystack for non-NGN orders', async () => {
    authenticate();
    mocks.fetch.mockResolvedValue({ ok: false });

    await resolveOrderReceiptVirtualAccount({
      merchant: null,
      order: makeOrder({ currency: 'USD' }),
    });

    expect(mocks.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/generate-dva'),
      expect.anything()
    );
  });

  it('does not provision Paystack for terminal or cancelled order states', async () => {
    authenticate();
    mocks.fetch.mockResolvedValue({ ok: false });

    for (const order of [
      makeOrder({ payment_status: 'refunded' }),
      makeOrder({ payment_status: 'bnpl_pending' }),
      makeOrder({ shipping_status: 'cancelled' }),
      makeOrder({ cancelled_at: '2026-08-24T12:00:00.000Z' }),
    ]) {
      await resolveOrderReceiptVirtualAccount({ merchant: null, order });
    }

    expect(mocks.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/generate-dva'),
      expect.anything()
    );
  });

  it('does not advertise an existing Paystack account without a customer email', async () => {
    authenticate();
    mocks.fetch.mockResolvedValue({ ok: false });

    const account = await resolveOrderReceiptVirtualAccount({
      merchant: null,
      order: makeOrder({
        customer_email: '',
        virtual_account: {
          account_name: 'Baci / Ada',
          account_number: '9876543210',
          bank_name: 'Paystack-Titan',
          provider: 'paystack',
        },
      }),
    });

    expect(account).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/generate-dva'),
      expect.anything()
    );
  });

  it('does not advertise a Paystack account after its assignment window', async () => {
    authenticate();
    mocks.fetch.mockResolvedValue({ ok: false });

    const account = await resolveOrderReceiptVirtualAccount({
      merchant: null,
      order: makeOrder({
        virtual_account: {
          account_name: 'Baci / Ada',
          account_number: '9876543210',
          bank_name: 'Paystack-Titan',
          provider: 'paystack',
          assigned_at: '2020-01-01T08:00:00.000Z',
          expires_at: '2020-01-01T09:30:00.000Z',
        },
      }),
    });

    expect(account).toBeNull();
  });
});
