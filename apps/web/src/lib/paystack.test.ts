import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('paystack helpers', () => {
  beforeEach(() => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_123');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('resolveAccountNumber accepts alphanumeric bank codes and calls fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          message: 'ok',
          data: {
            account_number: '1234567890',
            account_name: 'Jane Doe',
          },
        }),
      })
    );

    const { resolveAccountNumber } = await import('@/lib/paystack');
    const result = await resolveAccountNumber('1234567890', '035A');

    expect(result.success).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('bank_code=035A'),
      expect.any(Object)
    );
  });

  it('resolveAccountNumber rejects bank codes with punctuation', async () => {
    const { resolveAccountNumber } = await import('@/lib/paystack');
    const result = await resolveAccountNumber('1234567890', 'ABC-123');

    expect(result.success).toBe(false);
    expect(result).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns a validation error when saved-card charge payload is incomplete', async () => {
    const { chargeAuthorization } = await import('@/lib/paystack');
    const result = await chargeAuthorization({
      amount: 0,
      authorization_code: '',
      email: '',
    });

    expect(result).toEqual({
      success: false,
      error: 'Authorization code, email, and amount are required',
      code: 'VALIDATION_ERROR',
    });
  });

  it('includes authorization details in verifyTransaction responses', async () => {
    const { verifyTransaction } = await import('@/lib/paystack');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          message: 'ok',
          data: {
            id: 1,
            status: 'success',
            reference: 'REF123',
            amount: 100000,
            currency: 'NGN',
            channel: 'card',
            paid_at: '2026-04-08T12:00:00.000Z',
            created_at: '2026-04-08T12:00:00.000Z',
            customer: {
              id: 1,
              email: 'customer@example.com',
              customer_code: 'CUS_123',
              first_name: null,
              last_name: null,
              phone: null,
            },
            metadata: null,
            authorization: {
              authorization_code: 'AUTH_123',
              card_type: 'visa DEBIT',
              last4: '1234',
              exp_month: '08',
              exp_year: '2030',
              bank: 'Access Bank',
              channel: 'card',
              signature: 'SIG_123',
              reusable: true,
              country_code: 'NG',
            },
            fees: 150,
            fees_split: null,
          },
        }),
      })
    );

    const result = await verifyTransaction('REF123');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.authorization).toMatchObject({
        authorization_code: 'AUTH_123',
        reusable: true,
        signature: 'SIG_123',
      });
    }
  });

  it('rejects non-integer Paystack kobo amounts before converting to NGN', async () => {
    const { getPaystackRequestedAmountNgn } = await import('@/lib/paystack');

    expect(getPaystackRequestedAmountNgn({ amount: 100_000.5 })).toBeNull();
    expect(
      getPaystackRequestedAmountNgn({
        amount: 314_721,
        requested_amount: 300_000.5,
      })
    ).toBeNull();
  });

  it('creates wallet DVAs with merchant subaccount and explicit test-bank flag', async () => {
    // The explicit flag keeps test-bank routing intentional instead of inferring it from the secret-key prefix.
    vi.stubEnv('PAYSTACK_WALLET_DVA_USE_TEST_BANK', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          message: 'ok',
          data: {
            bank: {
              name: 'Test Bank',
              id: 9,
              slug: 'test-bank',
            },
            account_name: 'Ogabassey/Jane Doe',
            account_number: '1234567890',
            assigned: true,
            currency: 'NGN',
            metadata: null,
            active: true,
            id: 97,
            created_at: '2026-05-21T10:00:00.000Z',
            updated_at: '2026-05-21T10:00:00.000Z',
            customer: {
              id: 17328,
              email: 'jane@example.com',
              customer_code: 'CUS_wallet123',
              first_name: 'Jane',
              last_name: 'Doe',
            },
            split_config: {
              subaccount: 'ACCT_merchant123',
            },
          },
        }),
      })
    );

    const { createDedicatedAccountForWallet } = await import('@/lib/paystack');
    const result = await createDedicatedAccountForWallet({
      customerCode: 'CUS_wallet123',
      subaccount: 'ACCT_merchant123',
      preferredBank: 'wema-bank',
    });

    expect(result.success).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/dedicated_account'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          customer: 'CUS_wallet123',
          preferred_bank: 'test-bank',
          subaccount: 'ACCT_merchant123',
        }),
      })
    );

    if (result.success) {
      expect(result.data).toEqual({
        providerAccountId: '97',
        providerCustomerCode: 'CUS_wallet123',
        providerSubaccountCode: 'ACCT_merchant123',
        accountNumber: '1234567890',
        accountName: 'Ogabassey/Jane Doe',
        bankName: 'Test Bank',
        bankSlug: 'test-bank',
        currency: 'NGN',
      });
    }
  });

  it('accepts wallet DVA responses with stringified split config', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          message: 'ok',
          data: {
            bank: {
              name: 'Titan Paystack',
              id: 9,
              slug: 'titan-paystack',
            },
            account_name: 'Ogabassey/Jane Doe',
            account_number: '1234567890',
            assigned: true,
            currency: 'NGN',
            metadata: null,
            active: true,
            id: 97,
            created_at: '2026-05-21T10:00:00.000Z',
            updated_at: '2026-05-21T10:00:00.000Z',
            customer: {
              id: 17328,
              email: 'jane@example.com',
              customer_code: 'CUS_wallet123',
              first_name: 'Jane',
              last_name: 'Doe',
            },
            split_config: '{"subaccount":"ACCT_merchant123"}',
          },
        }),
      })
    );

    const { createDedicatedAccountForWallet } = await import('@/lib/paystack');
    const result = await createDedicatedAccountForWallet({
      customerCode: 'CUS_wallet123',
      subaccount: 'ACCT_merchant123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.providerSubaccountCode).toBe('ACCT_merchant123');
    }
  });

  it('rejects wallet DVA responses with a different split-config subaccount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          message: 'ok',
          data: {
            bank: {
              name: 'Titan Paystack',
              id: 9,
              slug: 'titan-paystack',
            },
            account_name: 'Ogabassey/Jane Doe',
            account_number: '1234567890',
            assigned: true,
            currency: 'NGN',
            metadata: null,
            active: true,
            id: 97,
            created_at: '2026-05-21T10:00:00.000Z',
            updated_at: '2026-05-21T10:00:00.000Z',
            customer: {
              id: 17328,
              email: 'jane@example.com',
              customer_code: 'CUS_wallet123',
              first_name: 'Jane',
              last_name: 'Doe',
            },
            split_config: {
              subaccount: 'ACCT_otherMerchant',
            },
          },
        }),
      })
    );

    const { createDedicatedAccountForWallet } = await import('@/lib/paystack');
    const result = await createDedicatedAccountForWallet({
      customerCode: 'CUS_wallet123',
      subaccount: 'ACCT_merchant123',
    });

    expect(result).toEqual({
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'Wallet DVA response returned a different Paystack subaccount',
    });
  });

  it('rejects wallet DVA responses that do not include a 10-digit account number', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          message: 'ok',
          data: {
            bank: { name: 'Wema Bank' },
            account_name: 'Ogabassey/Jane Doe',
            account_number: '123',
            currency: 'NGN',
            customer: {
              customer_code: 'CUS_wallet123',
            },
            split_config: {
              subaccount: 'ACCT_merchant123',
            },
          },
        }),
      })
    );

    const { createDedicatedAccountForWallet } = await import('@/lib/paystack');
    const result = await createDedicatedAccountForWallet({
      customerCode: 'CUS_wallet123',
      subaccount: 'ACCT_merchant123',
    });

    expect(result).toMatchObject({
      success: false,
      code: 'VALIDATION_ERROR',
    });
  });

  it('forwards an abort signal through the DVA chain and converts aborts to handled failures', async () => {
    const { generatePaymentAccount } = await import('@/lib/paystack');
    const controller = new AbortController();
    const seenSignals: Array<AbortSignal | null | undefined> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        seenSignals.push(init?.signal ?? null);
        if (init?.signal?.aborted) {
          throw new DOMException('aborted', 'AbortError');
        }
        return {
          ok: true,
          json: async () => ({ status: true, message: 'ok', data: {} }),
        };
      })
    );
    controller.abort();

    const result = await generatePaymentAccount({
      email: 'a@b.co',
      signal: controller.signal,
    });

    // Aborted before the first leg: handled failure (the provision
    // module maps it to retryable), and the signal reached fetch.
    expect(result.success).toBe(false);
    expect(seenSignals).toEqual([controller.signal]);
  });

  it('threads the signal through every DVA leg and reuses an existing account', async () => {
    const { generatePaymentAccount } = await import('@/lib/paystack');
    const controller = new AbortController();
    const seenSignals: Array<AbortSignal | null | undefined> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        seenSignals.push(init?.signal ?? null);
        if (String(url).endsWith('/customer')) {
          return {
            ok: true,
            json: async () => ({
              status: true,
              message: 'ok',
              data: { id: 1, customer_code: 'CUS_1', email: 'a@b.co' },
            }),
          };
        }
        // Existing-DVA lookup: the retry converges on this account
        // instead of creating a duplicate.
        return {
          ok: true,
          json: async () => ({
            status: true,
            message: 'ok',
            data: [
              {
                account_number: '1234567890',
                account_name: 'Baci / Ada',
                bank: { name: 'Wema Bank' },
              },
            ],
          }),
        };
      })
    );

    const result = await generatePaymentAccount({
      email: 'a@b.co',
      signal: controller.signal,
    });

    expect(result).toEqual({
      success: true,
      data: {
        bank_name: 'Wema Bank',
        account_number: '1234567890',
        account_name: 'Baci / Ada',
        customer_code: 'CUS_1',
      },
    });
    expect(seenSignals).toEqual([controller.signal, controller.signal]);
  });

  it('extracts receiver account numbers from supported Paystack DVA webhook shapes', async () => {
    const { extractPaystackReceiverAccountNumber } = await import(
      '@/lib/paystack'
    );

    expect(
      extractPaystackReceiverAccountNumber({
        data: { receiver_account_number: '1234567890' },
      })
    ).toBe('1234567890');
    expect(
      extractPaystackReceiverAccountNumber({
        data: { dedicated_account: { account_number: '0987654321' } },
      })
    ).toBe('0987654321');
    expect(
      extractPaystackReceiverAccountNumber({
        data: { authorization: { receiver_bank_account_number: '1122334455' } },
      })
    ).toBe('1122334455');
    expect(extractPaystackReceiverAccountNumber({ data: {} })).toBeNull();
  });
});
