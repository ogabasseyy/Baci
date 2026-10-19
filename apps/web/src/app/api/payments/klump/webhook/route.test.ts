import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  fetch: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  notifyNewOrder: vi.fn(),
  notifyPaymentReceived: vi.fn(),
  recordMerchantSettlement: vi.fn(),
  reconciliationInsert: vi.fn(),
  sendEmail: vi.fn(),
  transactionSelectSingle: vi.fn(),
  transactionUpdateMaybeSingle: vi.fn(),
  orderUpdateSingle: vi.fn(),
  orderUpdateNeq: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('@/lib/expo-push', () => ({
  notifyNewOrder: (...args: unknown[]) => mocks.notifyNewOrder(...args),
  notifyPaymentReceived: (...args: unknown[]) =>
    mocks.notifyPaymentReceived(...args),
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: (...args: unknown[]) => mocks.sendEmail(...args),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mocks.createAdminClient(),
}));

vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (callback: () => void | Promise<void>) => {
      void callback();
    },
  };
});

import { GET, HEAD, POST } from '@/app/api/payments/klump/webhook/route';

function signPayload(rawBody: string, secret: string) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function createRequest(body: Record<string, unknown>, signature?: string) {
  const rawBody = JSON.stringify(body);
  return new NextRequest('https://usebaci.com/api/payments/klump/webhook', {
    body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      ...(signature ? { 'X-Klump-Signature': signature } : {}),
      'X-Klump-Webhook-Attempt': '1',
      'X-Klump-Webhook-Id': 'webhook-123',
    },
    method: 'POST',
  });
}

function makeQueryChain<T>(result: T) {
  return {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    neq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
}

function makeUpdateChain<T>(result: T) {
  return {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    neq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
}

function createSupabaseMock({
  orderUpdateResult = {
    data: {
      currency: 'NGN',
      customer_email: 'buyer@example.com',
      customer_id: 'customer-123',
      customer_name: 'Buyer Name',
      customer_phone: '+2348000000000',
      discount_amount: 0,
      gift_wrapping_fee: 0,
      id: 'order-123',
      merchant_id: 'merchant-123',
      order_items: [
        {
          name: 'Phone',
          price: 50000,
          quantity: 1,
          subtotal: 50000,
        },
      ],
      order_number: 'ORD-123',
      payment_status: 'paid',
      shipping_address: { address: '1 Market Street' },
      shipping_fee: '0',
      shipping_status: 'processing',
      subtotal: '50000',
      tax_amount: 0,
      tax_basis: null,
      total: '50000',
      updated_at: '2026-05-20T00:00:00.000Z',
    },
    error: null,
  },
  transactionUpdateResult = {
    data: { id: 'transaction-123' },
    error: null,
  },
  inventoryConfirmationResult = {
    data: { current_status: 'claimed', we_won: true },
    error: null,
  },
  merchantAmount = null,
  platformFee = null,
  preUpdateOrderStatusResult = {
    data: { payment_status: 'pending', shipping_status: 'pending' },
    error: null,
  },
  settlementResult = { data: null, error: null },
  transactionAmount = '50000',
  transactionStatus = 'pending',
}: {
  inventoryConfirmationResult?: { data: unknown; error: unknown };
  merchantAmount?: number | string | null;
  orderUpdateResult?: { data: unknown; error: unknown };
  platformFee?: number | string | null;
  preUpdateOrderStatusResult?: { data: unknown; error: unknown };
  settlementResult?: { data: unknown; error: unknown };
  transactionAmount?: number | string | null;
  transactionStatus?: string;
  transactionUpdateResult?: { data: unknown; error: unknown };
} = {}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'transactions') {
        return {
          select: vi.fn(() =>
            makeQueryChain({
              data: {
                amount: transactionAmount,
                currency: 'NGN',
                gateway_reference: 'BAC-ABCD12345678',
                id: 'transaction-123',
                merchant_amount: merchantAmount,
                merchant_id: 'merchant-123',
                metadata: {},
                order_id: 'order-123',
                platform_fee: platformFee,
                status: transactionStatus,
              },
              error: null,
            })
          ),
          update: vi.fn((payload: unknown) => {
            mocks.transactionUpdateMaybeSingle(payload);
            return makeUpdateChain(transactionUpdateResult);
          }),
        };
      }

      if (table === 'orders') {
        return {
          select: vi.fn(() => makeQueryChain(preUpdateOrderStatusResult)),
          update: vi.fn((payload: unknown) => {
            mocks.orderUpdateSingle(payload);
            const chain = makeUpdateChain(orderUpdateResult);
            chain.neq = vi.fn((...args: unknown[]) => {
              mocks.orderUpdateNeq(...args);
              return chain;
            });
            return chain;
          }),
        };
      }

      if (table === 'reconciliation_review') {
        return {
          insert: vi.fn((row: unknown) => {
            mocks.reconciliationInsert(row);
            return Promise.resolve({ data: null, error: null });
          }),
        };
      }

      if (table === 'merchants') {
        return {
          select: vi.fn(() =>
            makeQueryChain({
              data: {
                business_name: 'Baci Store',
                cac_rc_number: null,
                email: 'merchant@example.com',
                email_sender_name: null,
                slug: 'baci-store',
                support_email: null,
                tax_identification_number: null,
              },
              error: null,
            })
          ),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
    rpc: vi.fn((name: string, args: unknown) => {
      if (name === 'record_merchant_settlement') {
        mocks.recordMerchantSettlement(args);
        return Promise.resolve(settlementResult);
      }

      if (name === 'confirm_order_inventory_reservations') {
        return Object.assign(Promise.resolve(inventoryConfirmationResult), {
          single: () => Promise.resolve(inventoryConfirmationResult),
        });
      }

      const result = {
        data: { current_status: 'claimed', we_won: true },
        error: null,
      };

      return Object.assign(Promise.resolve(result), {
        single: () => Promise.resolve(result),
      });
    }),
  };
}

const successfulPayload = {
  data: {
    amount: 50000,
    currency: 'NGN',
    id: 'klump-txn-123',
    is_live: true,
    merchant_reference: 'BAC-ABCD12345678',
    status: 'successful',
  },
  event: 'klump.payment.transaction.successful',
};

function mockVerifiedKlumpTransaction(overrides: Record<string, unknown> = {}) {
  mocks.fetch.mockResolvedValue(
    Response.json({
      data: {
        amount: 50000,
        currency: 'NGN',
        id: 'klump-txn-123',
        is_live: true,
        merchant_reference: 'BAC-ABCD12345678',
        status: 'successful',
        ...overrides,
      },
    })
  );
}

describe('POST /api/payments/klump/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KLUMP_SECRET_KEY = 'klump-secret';
    delete process.env.KLUMP_WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
    vi.stubGlobal('fetch', mocks.fetch);
    mockVerifiedKlumpTransaction();
    mocks.createAdminClient.mockReturnValue(createSupabaseMock());
    mocks.sendEmail.mockResolvedValue({
      messageId: 'message-123',
      success: true,
    });
  });

  it('acknowledges Klump dashboard reachability checks', async () => {
    const response = GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      message: 'Klump webhook endpoint reachable',
      success: true,
    });
  });

  it('acknowledges Klump dashboard HEAD checks', () => {
    const response = HEAD();

    expect(response.status).toBe(200);
  });

  it('acknowledges unsigned empty setup probes before database writes', async () => {
    const response = await POST(createRequest({}));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      message: 'Klump webhook endpoint reachable',
      success: true,
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects unsigned webhook events before database writes', async () => {
    const response = await POST(createRequest(successfulPayload));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Invalid signature');
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects unsigned top-level payment payloads before database writes', async () => {
    const response = await POST(
      createRequest({
        amount: 50000,
        currency: 'NGN',
        id: 'klump-txn-123',
        is_live: true,
        merchant_reference: 'BAC-ABCD12345678',
        status: 'successful',
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Invalid signature');
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects webhook calls with invalid signatures before database writes', async () => {
    const response = await POST(
      createRequest(successfulPayload, 'bad-signature')
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Invalid signature');
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('marks the Klump transaction and order paid after a signed successful event', async () => {
    const rawBody = JSON.stringify(successfulPayload);
    const response = await POST(
      createRequest(successfulPayload, signPayload(rawBody, 'klump-secret'))
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      message: 'Klump payment processed successfully',
      success: true,
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.useklump.com/v1/transactions/klump-txn-123/verify',
      expect.objectContaining({
        headers: expect.objectContaining({
          'klump-secret-key': 'klump-secret',
        }),
        method: 'GET',
      })
    );
    expect(mocks.transactionUpdateMaybeSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
      })
    );
    expect(mocks.fetch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.transactionUpdateMaybeSingle.mock.invocationCallOrder[0]
    );
    expect(mocks.orderUpdateSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_status: 'paid',
        shipping_status: 'processing',
      })
    );
    // A payment-only cancellation is terminal: the paid write must
    // exclude both cancelled spellings so a late capture cannot
    // reopen an order whose loyalty claim was already released.
    expect(mocks.orderUpdateNeq).toHaveBeenCalledWith(
      'payment_status',
      'cancelled'
    );
    expect(mocks.orderUpdateNeq).toHaveBeenCalledWith(
      'payment_status',
      'canceled'
    );
    expect(
      mocks.transactionUpdateMaybeSingle.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.orderUpdateSingle.mock.invocationCallOrder[0]);
    expect(mocks.recordMerchantSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        p_gateway: 'klump',
        p_gateway_reference: 'BAC-ABCD12345678',
        p_gross_amount: 50000,
        p_merchant_id: 'merchant-123',
        p_source_id: 'order-123',
        p_source_type: 'order',
      })
    );
  });

  it('rolls back the order to its actual pre-update status when inventory confirmation fails', async () => {
    mocks.createAdminClient.mockReturnValue(
      createSupabaseMock({
        preUpdateOrderStatusResult: {
          data: {
            payment_status: 'bnpl_pending',
            shipping_status: 'confirmed',
          },
          error: null,
        },
        inventoryConfirmationResult: {
          data: null,
          error: { message: 'inventory rpc unavailable' },
        },
      })
    );

    const rawBody = JSON.stringify(successfulPayload);
    const response = await POST(
      createRequest(successfulPayload, signPayload(rawBody, 'klump-secret'))
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      code: 'INVENTORY_CONFIRMATION_FAILED',
      error: 'Inventory confirmation failed',
    });
    // The first orders.update flips the order to paid; the second is the
    // rollback, which must restore the order's ACTUAL pre-update status
    // ('bnpl_pending' / 'confirmed'), not a hardcoded 'pending'/'pending'.
    expect(mocks.orderUpdateSingle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payment_status: 'bnpl_pending',
        shipping_status: 'confirmed',
      })
    );
  });

  it('fails closed before mutating when the pre-update snapshot read fails', async () => {
    mocks.createAdminClient.mockReturnValue(
      createSupabaseMock({
        preUpdateOrderStatusResult: {
          data: null,
          error: { message: 'transient select failure' },
        },
      })
    );

    const rawBody = JSON.stringify(successfulPayload);
    const response = await POST(
      createRequest(successfulPayload, signPayload(rawBody, 'klump-secret'))
    );
    const body = await response.json();

    // Without a trustworthy snapshot the order must not be flipped at all —
    // Klump redelivers on non-2xx and the retry re-reads a fresh snapshot.
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to snapshot order status' });
    expect(mocks.orderUpdateSingle).not.toHaveBeenCalled();
  });

  it('suppresses settlement + notification and files reconciliation when the order was clamped as cancelled', async () => {
    mocks.createAdminClient.mockReturnValue(
      createSupabaseMock({
        orderUpdateResult: {
          data: {
            id: 'order-123',
            merchant_id: 'merchant-123',
            order_number: 'ORD-123',
            customer_name: 'Buyer Name',
            total: '50000',
            currency: 'NGN',
            shipping_status: 'cancelled',
            cancelled_at: '2026-06-15T00:00:00Z',
          },
          error: null,
        },
      })
    );

    const rawBody = JSON.stringify(successfulPayload);
    const response = await POST(
      createRequest(successfulPayload, signPayload(rawBody, 'klump-secret'))
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      message: 'Klump payment recorded; order was cancelled, filed for review',
      success: true,
    });
    // No settlement and no merchant notification fired.
    expect(mocks.recordMerchantSettlement).not.toHaveBeenCalled();
    expect(mocks.notifyNewOrder).not.toHaveBeenCalled();
    // Reconciliation row was filed.
    expect(mocks.reconciliationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'payment_received_after_cancellation',
        order_id: 'order-123',
      })
    );
  });

  it('files reconciliation when the paid update was filtered out by a payment-only cancellation', async () => {
    // mark_abandoned_orders cancelled only payment_status: the update
    // predicates exclude the row, so the webhook must reconcile the
    // existing cancelled order instead of confirming inventory on it.
    mocks.createAdminClient.mockReturnValue(
      createSupabaseMock({
        orderUpdateResult: { data: null, error: null },
        preUpdateOrderStatusResult: {
          data: { payment_status: 'cancelled', shipping_status: 'pending' },
          error: null,
        },
      })
    );

    const rawBody = JSON.stringify(successfulPayload);
    const response = await POST(
      createRequest(successfulPayload, signPayload(rawBody, 'klump-secret'))
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      message: 'Klump payment recorded; order was cancelled, filed for review',
      success: true,
    });
    expect(mocks.recordMerchantSettlement).not.toHaveBeenCalled();
    expect(mocks.notifyNewOrder).not.toHaveBeenCalled();
    expect(mocks.reconciliationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'payment_received_after_cancellation',
      })
    );
  });

  it('files reconciliation when the paid update was filtered out by a shipping-only cancellation', async () => {
    mocks.createAdminClient.mockReturnValue(
      createSupabaseMock({
        orderUpdateResult: { data: null, error: null },
        preUpdateOrderStatusResult: {
          data: { payment_status: 'unpaid', shipping_status: 'cancelled' },
          error: null,
        },
      })
    );

    const rawBody = JSON.stringify(successfulPayload);
    const response = await POST(
      createRequest(successfulPayload, signPayload(rawBody, 'klump-secret'))
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      message: 'Klump payment recorded; order was cancelled, filed for review',
      success: true,
    });
    expect(mocks.recordMerchantSettlement).not.toHaveBeenCalled();
    expect(mocks.reconciliationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'payment_received_after_cancellation',
      })
    );
    // The paid write fences the shipping axis as well as payment.
    expect(mocks.orderUpdateNeq).toHaveBeenCalledWith(
      'shipping_status',
      'cancelled'
    );
  });

  it('validates rounded Klump payments against merchant_amount when the stored order total is fractional', async () => {
    const payload = {
      ...successfulPayload,
      data: {
        ...successfulPayload.data,
        amount: 58_089,
      },
    };
    mocks.createAdminClient.mockReturnValue(
      createSupabaseMock({
        merchantAmount: 58_089,
        transactionAmount: '58088.5',
      })
    );
    mockVerifiedKlumpTransaction({ amount: 58_089 });
    const rawBody = JSON.stringify(payload);

    const response = await POST(
      createRequest(payload, signPayload(rawBody, 'klump-secret'))
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      message: 'Klump payment processed successfully',
      success: true,
    });
    expect(mocks.recordMerchantSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        p_gross_amount: 58_089,
      })
    );
  });

  it('uses Klump original_amount when customer charged amount includes Klump fees', async () => {
    const payload = {
      ...successfulPayload,
      data: {
        ...successfulPayload.data,
        amount: '694122.50',
        id: 'klump-txn-with-fee',
        original_amount: '687250.00',
        status: 'successful',
      },
    };
    mocks.createAdminClient.mockReturnValue(
      createSupabaseMock({
        merchantAmount: 687250,
        transactionAmount: '687250',
      })
    );
    mocks.fetch.mockResolvedValue(
      Response.json({
        data: {
          amount: '694122.50',
          currency: 'NGN',
          id: 'klump-txn-with-fee',
          is_live: true,
          merchant_reference: 'BAC-ABCD12345678',
          original_amount: '687250.00',
          status: 'successful',
        },
        state: 'success',
      })
    );
    const rawBody = JSON.stringify(payload);

    const response = await POST(
      createRequest(payload, signPayload(rawBody, 'klump-secret'))
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      message: 'Klump payment processed successfully',
      success: true,
    });
    expect(mocks.recordMerchantSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        p_gross_amount: 687250,
      })
    );
  });

  it('preserves an explicit zero platform fee when recording settlement', async () => {
    mocks.createAdminClient.mockReturnValue(
      createSupabaseMock({
        platformFee: 0,
      })
    );
    const rawBody = JSON.stringify(successfulPayload);

    const response = await POST(
      createRequest(successfulPayload, signPayload(rawBody, 'klump-secret'))
    );

    expect(response.status).toBe(200);
    expect(mocks.recordMerchantSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        p_platform_fee: 0,
      })
    );
  });

  it('acknowledges non-success events without marking the order paid', async () => {
    const payload = {
      ...successfulPayload,
      event: 'klump.payment.transaction.initiated',
    };
    const rawBody = JSON.stringify(payload);

    const response = await POST(
      createRequest(payload, signPayload(rawBody, 'klump-secret'))
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe('Event ignored');
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects sandbox success events before marking the order paid', async () => {
    const payload = {
      ...successfulPayload,
      data: {
        ...successfulPayload.data,
        is_live: false,
      },
    };
    const rawBody = JSON.stringify(payload);

    const response = await POST(
      createRequest(payload, signPayload(rawBody, 'klump-secret'))
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Sandbox Klump webhook not accepted');
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('does not mark the order paid when Klump provider verification fails', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ error: 'not found' }, { status: 404 })
    );
    const rawBody = JSON.stringify(successfulPayload);

    const response = await POST(
      createRequest(successfulPayload, signPayload(rawBody, 'klump-secret'))
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe('Klump transaction verification failed');
    expect(mocks.transactionUpdateMaybeSingle).not.toHaveBeenCalled();
    expect(mocks.orderUpdateSingle).not.toHaveBeenCalled();
    expect(mocks.recordMerchantSettlement).not.toHaveBeenCalled();
  });

  it('does not mark the order paid when provider verification returns a different amount', async () => {
    mockVerifiedKlumpTransaction({ amount: 49000 });
    const rawBody = JSON.stringify(successfulPayload);

    const response = await POST(
      createRequest(successfulPayload, signPayload(rawBody, 'klump-secret'))
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Verified payment amount mismatch');
    expect(mocks.transactionUpdateMaybeSingle).not.toHaveBeenCalled();
    expect(mocks.orderUpdateSingle).not.toHaveBeenCalled();
    expect(mocks.recordMerchantSettlement).not.toHaveBeenCalled();
  });

  it('uses the webhook secret for provider verification when the Klump secret key is unset', async () => {
    delete process.env.KLUMP_SECRET_KEY;
    process.env.KLUMP_WEBHOOK_SECRET = 'webhook-secret';
    const rawBody = JSON.stringify(successfulPayload);

    const response = await POST(
      createRequest(successfulPayload, signPayload(rawBody, 'webhook-secret'))
    );

    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.useklump.com/v1/transactions/klump-txn-123/verify',
      expect.objectContaining({
        headers: expect.objectContaining({
          'klump-secret-key': 'webhook-secret',
        }),
        method: 'GET',
      })
    );
    expect(mocks.transactionUpdateMaybeSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
      })
    );
    expect(mocks.recordMerchantSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        p_gateway: 'klump',
        p_gateway_reference: 'BAC-ABCD12345678',
      })
    );
  });

  it('does not mark the order paid when the transaction update fails', async () => {
    mocks.createAdminClient.mockReturnValue(
      createSupabaseMock({
        transactionUpdateResult: {
          data: null,
          error: { message: 'transaction update failed' },
        },
      })
    );
    const rawBody = JSON.stringify(successfulPayload);

    const response = await POST(
      createRequest(successfulPayload, signPayload(rawBody, 'klump-secret'))
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to update transaction');
    expect(mocks.transactionUpdateMaybeSingle).toHaveBeenCalled();
    expect(mocks.orderUpdateSingle).not.toHaveBeenCalled();
  });

  it('continues downstream reconciliation when a concurrent webhook completes the transaction first', async () => {
    mocks.createAdminClient.mockReturnValue(
      createSupabaseMock({
        transactionUpdateResult: {
          data: null,
          error: null,
        },
      })
    );
    const rawBody = JSON.stringify(successfulPayload);

    const response = await POST(
      createRequest(successfulPayload, signPayload(rawBody, 'klump-secret'))
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      message: 'Klump payment processed successfully',
      success: true,
    });
    expect(mocks.transactionUpdateMaybeSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
      })
    );
    expect(mocks.orderUpdateSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_status: 'paid',
        shipping_status: 'processing',
      })
    );
    expect(mocks.recordMerchantSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        p_gateway: 'klump',
        p_gateway_reference: 'BAC-ABCD12345678',
      })
    );
  });

  it('retries downstream order and settlement work when the Klump transaction is already completed', async () => {
    mocks.createAdminClient.mockReturnValue(
      createSupabaseMock({
        transactionStatus: 'completed',
      })
    );
    const rawBody = JSON.stringify(successfulPayload);

    const response = await POST(
      createRequest(successfulPayload, signPayload(rawBody, 'klump-secret'))
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      message: 'Klump payment processed successfully',
      success: true,
    });
    expect(mocks.transactionUpdateMaybeSingle).not.toHaveBeenCalled();
    expect(mocks.orderUpdateSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_status: 'paid',
        shipping_status: 'processing',
      })
    );
    expect(mocks.recordMerchantSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        p_gateway: 'klump',
        p_gateway_reference: 'BAC-ABCD12345678',
      })
    );
  });

  it('returns 500 when settlement recording fails so Klump can retry', async () => {
    mocks.createAdminClient.mockReturnValue(
      createSupabaseMock({
        settlementResult: {
          data: null,
          error: { message: 'settlement unavailable' },
        },
      })
    );
    const rawBody = JSON.stringify(successfulPayload);

    const response = await POST(
      createRequest(successfulPayload, signPayload(rawBody, 'klump-secret'))
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to record settlement');
    expect(mocks.recordMerchantSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        p_gateway: 'klump',
        p_gateway_reference: 'BAC-ABCD12345678',
      })
    );
  });
});
