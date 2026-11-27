import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockResolveVtuCustomer = vi.fn();
const mockVerifyPaystackTransaction = vi.fn();
const mockCreditWalletTopUp = vi.fn();
const mockNotifyWalletCredited = vi.fn();
const mockClaimWalletCreditPush = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ status: 'claimed' })
);
const mockReleaseWalletCreditPush = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ status: 'released' })
);
const mockFrom = vi.fn();

// `after` runs the scheduled push immediately here so the assertions can see it;
// in production it runs off the response path.
vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: vi.fn((task: () => Promise<void>) => {
      void task();
    }),
  };
});

vi.mock('@/lib/payments/notify-wallet-credited', () => ({
  notifyWalletCredited: (...args: unknown[]) =>
    mockNotifyWalletCredited(...args),
}));

vi.mock('@/lib/payments/claim-wallet-credit-push', () => ({
  claimWalletCreditPush: (...args: unknown[]) =>
    mockClaimWalletCreditPush(...args),
}));

vi.mock('@/lib/payments/release-wallet-credit-push', () => ({
  releaseWalletCreditPush: (...args: unknown[]) =>
    mockReleaseWalletCreditPush(...args),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(() =>
    Promise.resolve({ valid: true, response: null })
  ),
}));

vi.mock('@/lib/paystack', () => ({
  verifyTransaction: (...args: unknown[]) =>
    mockVerifyPaystackTransaction(...args),
}));

vi.mock('@/lib/korapay', () => ({
  verifyPayment: vi.fn(),
}));

vi.mock('@/lib/customer-wallet-top-up', () => ({
  creditWalletTopUp: (...args: unknown[]) => mockCreditWalletTopUp(...args),
  WALLET_TOP_UP_TRANSACTION_TYPE: 'wallet_topup',
}));

vi.mock('@/lib/vtu-pending-transaction', () => ({
  resolveVtuCustomer: (...args: unknown[]) => mockResolveVtuCustomer(...args),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import { POST } from './route';

const VALID_MERCHANT_ID = '00000000-0000-4000-8000-000000000001';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(
    'http://localhost:3000/api/storefront/customer/wallet/top-up/confirm',
    {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  );
}

const defaultTransaction = {
  amount: 2500,
  currency: 'NGN',
  gateway: 'paystack',
  id: 'txn-1',
  merchant_id: 'merchant-1',
  metadata: {
    customer_id: 'customer-1',
    transaction_type: 'wallet_topup',
  },
  status: 'pending',
};

describe('POST /api/storefront/customer/wallet/top-up/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaimWalletCreditPush.mockResolvedValue({ status: 'claimed' });
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: {},
      user: { email: 'customer@example.com', id: 'user-1' },
    });
    mockResolveVtuCustomer.mockResolvedValue({ id: 'customer-1' });
    mockVerifyPaystackTransaction.mockResolvedValue({
      data: {
        amount: 250000,
        currency: 'NGN',
        status: 'success',
      },
      success: true,
    });
    mockCreditWalletTopUp.mockResolvedValue({
      balance: 7500,
      reference: 'WAL-123',
      transactionId: 'wallet-tx-1',
    });
    mockNotifyWalletCredited.mockResolvedValue({ status: 'sent' });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'merchant-1' },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'transactions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: defaultTransaction,
                  error: null,
                }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'txn-1' },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('returns 401 when the request is not authenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValueOnce({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });

    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: 'Unauthorized' });
    expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid confirmation input', async () => {
    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toMatchObject({ error: 'Invalid input' });
    expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed merchant ids before merchant lookup', async () => {
    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantId: 'not-a-uuid',
        reference: 'WAL-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toMatchObject({ error: 'Invalid input' });
    expect(data).toHaveProperty('details.fieldErrors.merchantId');
    expect(data.details.fieldErrors.merchantId).toEqual(
      expect.arrayContaining(['Merchant id must be a valid UUID'])
    );
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
  });

  it('returns 500 when gateway verification throws unexpectedly', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockVerifyPaystackTransaction.mockRejectedValueOnce(
      new Error('gateway unavailable')
    );

    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: 'Failed to confirm wallet top-up' });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to confirm wallet top-up',
      expect.any(Error)
    );
    expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('returns 404 when the wallet top-up payment does not exist', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'merchant-1' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'transactions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );

    expect(response.status).toBe(404);
  });

  it('confirms payment and credits the customer wallet idempotently', async () => {
    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      amount: 2500,
      reference: 'WAL-123',
      status: 'successful',
      success: true,
      wallet: {
        balance: 7500,
      },
    });
    expect(mockCreditWalletTopUp).toHaveBeenCalledTimes(1);
    expect(mockCreditWalletTopUp).toHaveBeenCalledWith({
      amount: 2500,
      customerId: 'customer-1',
      gateway: 'paystack',
      merchantId: 'merchant-1',
      reference: 'WAL-123',
      supabase: expect.any(Object),
      transactionId: 'txn-1',
    });
  });

  it('bugfix: credits the principal when the customer paid the Paystack fee on top', async () => {
    mockVerifyPaystackTransaction.mockResolvedValueOnce({
      data: {
        amount: 253_750,
        currency: 'NGN',
        fees: 3_750,
        requested_amount: 250_000,
        status: 'success',
      },
      success: true,
    });

    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );

    expect(response.status).toBe(200);
    expect(mockCreditWalletTopUp).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, reference: 'WAL-123' })
    );
  });

  it('still rejects a gross amount whose fee split Paystack does not prove', async () => {
    mockVerifyPaystackTransaction.mockResolvedValueOnce({
      data: {
        amount: 253_750,
        currency: 'NGN',
        fees: 3_000,
        requested_amount: 250_000,
        status: 'success',
      },
      success: true,
    });

    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Payment amount mismatch' });
    expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
  });

  it('confirms with merchantId when the storefront slug is unavailable or stale', async () => {
    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantId: VALID_MERCHANT_ID,
        reference: 'WAL-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      reference: 'WAL-123',
      status: 'successful',
      success: true,
    });
    expect(mockCreditWalletTopUp).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        reference: 'WAL-123',
      })
    );
  });

  it('uses the stored transaction gateway when the request gateway mismatches', async () => {
    const response = await POST(
      makeRequest({
        gateway: 'korapay',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      reference: 'WAL-123',
      status: 'successful',
      success: true,
    });
    expect(mockVerifyPaystackTransaction).toHaveBeenCalledWith('WAL-123');
    expect(mockCreditWalletTopUp).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: 'paystack',
        reference: 'WAL-123',
      })
    );
  });

  it('returns 500 without exposing provider verification outages', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockVerifyPaystackTransaction.mockResolvedValueOnce({
      code: 'NETWORK_ERROR',
      error: 'provider timeout',
      success: false,
    });

    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: 'Payment verification failed' });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Wallet top-up payment verification failed',
      expect.objectContaining({
        code: 'NETWORK_ERROR',
        error: 'provider timeout',
      })
    );
    expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('returns 400 for client-side verification failures', async () => {
    mockVerifyPaystackTransaction.mockResolvedValueOnce({
      code: 'VALIDATION_ERROR',
      error: 'Invalid transaction reference format',
      success: false,
    });

    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Invalid transaction reference format' });
    expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
  });

  it('retries the idempotent wallet credit when another request already completed the transaction', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'merchant-1' },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'transactions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: defaultTransaction,
                  error: null,
                }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      amount: 2500,
      reference: 'WAL-123',
      status: 'successful',
      success: true,
      wallet: {
        balance: 7500,
      },
    });
    expect(mockCreditWalletTopUp).toHaveBeenCalledTimes(1);
    expect(mockCreditWalletTopUp).toHaveBeenCalledWith({
      amount: 2500,
      customerId: 'customer-1',
      gateway: 'paystack',
      merchantId: 'merchant-1',
      reference: 'WAL-123',
      supabase: expect.any(Object),
      transactionId: 'txn-1',
    });
  });

  it('retries the idempotent wallet credit when the transaction was already completed', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'merchant-1' },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'transactions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { ...defaultTransaction, status: 'completed' },
                  error: null,
                }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockVerifyPaystackTransaction).not.toHaveBeenCalled();
    expect(data).toEqual({
      amount: 2500,
      reference: 'WAL-123',
      status: 'successful',
      success: true,
      wallet: {
        balance: 7500,
      },
    });
    expect(mockCreditWalletTopUp).toHaveBeenCalledTimes(1);
    expect(mockCreditWalletTopUp).toHaveBeenCalledWith({
      amount: 2500,
      customerId: 'customer-1',
      gateway: 'paystack',
      merchantId: 'merchant-1',
      reference: 'WAL-123',
      supabase: expect.any(Object),
      transactionId: 'txn-1',
    });
  });

  it('rejects successful gateway responses without a verified amount', async () => {
    mockVerifyPaystackTransaction.mockResolvedValueOnce({
      data: {
        currency: 'NGN',
        status: 'success',
      },
      success: true,
    });

    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Unable to verify payment amount' });
    expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
  });

  it('rejects successful gateway responses with a mismatched currency', async () => {
    mockVerifyPaystackTransaction.mockResolvedValueOnce({
      data: {
        amount: 250000,
        currency: 'USD',
        status: 'success',
      },
      success: true,
    });

    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Payment currency mismatch' });
    expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
  });

  it.each([
    'failed',
    'abandoned',
  ])('returns a terminal error when gateway status is %s', async (status) => {
    mockVerifyPaystackTransaction.mockResolvedValueOnce({
      data: {
        amount: 250_000,
        currency: 'NGN',
        status,
      },
      success: true,
    });

    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Payment was not successful',
      status,
    });
    expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
  });

  it('keeps pending gateway statuses retryable', async () => {
    mockVerifyPaystackTransaction.mockResolvedValueOnce({
      data: {
        amount: 250_000,
        currency: 'NGN',
        status: 'pending',
      },
      success: true,
    });

    const response = await POST(
      makeRequest({
        gateway: 'paystack',
        merchantSlug: 'ogabassey',
        reference: 'WAL-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({
      error: 'Payment is not yet successful',
      status: 'pending',
    });
    expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
  });

  describe('wallet-credited push', () => {
    function mockTransaction(transaction: Record<string, unknown>) {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'merchant-1' },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === 'transactions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: transaction,
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { id: 'txn-1' },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      });
    }

    function confirmRequest() {
      return POST(
        makeRequest({
          gateway: 'paystack',
          merchantSlug: 'ogabassey',
          reference: 'WAL-123',
        })
      );
    }

    it('notifies the customer when this route wins the race and takes the first credit', async () => {
      mockTransaction({
        ...defaultTransaction,
        metadata: {
          ...defaultTransaction.metadata,
          return_to: '/checkout',
        },
      });
      mockCreditWalletTopUp.mockResolvedValue({
        balance: 7500,
        firstCredit: true,
        reference: 'WAL-123',
        transactionId: 'wallet-tx-1',
      });

      const response = await confirmRequest();

      expect(response.status).toBe(200);
      await vi.waitFor(() =>
        expect(mockNotifyWalletCredited).toHaveBeenCalledTimes(1)
      );
      expect(mockNotifyWalletCredited).toHaveBeenCalledWith({
        amount: 2500,
        currency: 'NGN',
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        returnTo: '/checkout',
      });
    });

    it('stays silent when the webhook won the race and already took the credit', async () => {
      vi.useFakeTimers();
      mockTransaction({ ...defaultTransaction, status: 'completed' });
      mockCreditWalletTopUp.mockResolvedValue({
        balance: 7500,
        firstCredit: false,
        reference: 'WAL-123',
        transactionId: 'wallet-tx-1',
      });
      mockClaimWalletCreditPush.mockResolvedValue({
        status: 'already_claimed',
      });

      try {
        const response = await confirmRequest();
        await vi.runAllTimersAsync();

        expect(response.status).toBe(200);
        expect(mockCreditWalletTopUp).toHaveBeenCalledTimes(1);
        expect(mockNotifyWalletCredited).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('notifies from the already-completed branch when that retry lands the credit', async () => {
      mockTransaction({
        ...defaultTransaction,
        metadata: {
          ...defaultTransaction.metadata,
          return_to: '/utilities/airtime',
        },
        status: 'completed',
      });
      mockCreditWalletTopUp.mockResolvedValue({
        balance: 7500,
        firstCredit: true,
        reference: 'WAL-123',
        transactionId: 'wallet-tx-1',
      });

      const response = await confirmRequest();

      expect(response.status).toBe(200);
      await vi.waitFor(() =>
        expect(mockNotifyWalletCredited).toHaveBeenCalledTimes(1)
      );
      expect(mockNotifyWalletCredited).toHaveBeenCalledWith(
        expect.objectContaining({ returnTo: '/utilities/airtime' })
      );
    });

    it('drops a non-resumable metadata destination instead of deep-linking to it', async () => {
      mockTransaction({
        ...defaultTransaction,
        metadata: {
          ...defaultTransaction.metadata,
          return_to: '/auth/callback?returnTo=//evil.com',
        },
      });
      mockCreditWalletTopUp.mockResolvedValue({
        balance: 7500,
        firstCredit: true,
        reference: 'WAL-123',
        transactionId: 'wallet-tx-1',
      });

      const response = await confirmRequest();

      expect(response.status).toBe(200);
      await vi.waitFor(() =>
        expect(mockNotifyWalletCredited).toHaveBeenCalledWith(
          expect.objectContaining({ returnTo: undefined })
        )
      );
    });

    it('still returns 200 when the push itself fails', async () => {
      mockTransaction(defaultTransaction);
      mockCreditWalletTopUp.mockResolvedValue({
        balance: 7500,
        firstCredit: true,
        reference: 'WAL-123',
        transactionId: 'wallet-tx-1',
      });
      mockNotifyWalletCredited.mockRejectedValue(new Error('expo down'));

      const response = await confirmRequest();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});
