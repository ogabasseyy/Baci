import { beforeEach, describe, expect, it } from 'vitest';
import {
  authenticateMerchant,
  createParams,
  createRequest,
  generateDvaTestMocks,
  generatedDva,
  ORDER_ID,
  postGenerateDva as POST,
  resetGenerateDvaMocks,
  unpaidOrder,
  useOrderQueries,
} from './generate-dva-test-support';

const {
  mockCreatePaystackDvaReservationProof,
  mockGeneratePaymentAccount,
  mockRpc,
} = generateDvaTestMocks;

describe('POST /api/orders/[id]/generate-dva provisioning', () => {
  beforeEach(resetGenerateDvaMocks);

  it('releases and reprovisions an expired Paystack account', async () => {
    authenticateMerchant();
    const paymentAccountQuery = useOrderQueries();
    paymentAccountQuery.maybeSingle
      .mockResolvedValueOnce({
        data: {
          account_number: '1234567890',
          bank_name: 'Wema Bank',
          account_name: 'Ogabassey/John Doe',
          provider: 'paystack',
          assigned_at: '2026-08-24T08:00:00.000Z',
          expires_at: '2026-08-24T09:30:00.000Z',
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    mockGeneratePaymentAccount.mockResolvedValue(generatedDva);

    const response = await POST(createRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.virtualAccount.account_number).toBe('9876543210');
    expect(mockRpc).toHaveBeenCalledWith(
      'release_expired_paystack_order_account',
      { p_order_id: ORDER_ID }
    );
    expect(mockGeneratePaymentAccount).toHaveBeenCalled();
    expect(paymentAccountQuery.order).toHaveBeenNthCalledWith(
      1,
      'assigned_at',
      {
        ascending: false,
        nullsFirst: false,
      }
    );
    expect(paymentAccountQuery.order).toHaveBeenNthCalledWith(2, 'created_at', {
      ascending: false,
    });
    expect(paymentAccountQuery.limit).toHaveBeenCalledWith(1);
  });

  it('returns a concurrently reprovisioned account when release observes a winner', async () => {
    authenticateMerchant();
    const paymentAccountQuery = useOrderQueries();
    paymentAccountQuery.maybeSingle
      .mockResolvedValueOnce({
        data: {
          account_number: '1234567890',
          bank_name: 'Wema Bank',
          account_name: 'Ogabassey/Old Customer',
          provider: 'paystack',
          assigned_at: '2026-08-24T08:00:00.000Z',
          expires_at: '2026-08-24T09:30:00.000Z',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          account_number: '9876543210',
          bank_name: 'Wema Bank',
          account_name: 'Ogabassey/John Doe',
          provider: 'paystack',
          assigned_at: '2026-08-24T10:00:00.000Z',
          expires_at: '2999-01-01T01:30:00.000Z',
        },
        error: null,
      });
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'release_expired_paystack_order_account'
          ? { data: false, error: null }
          : { data: 5000, error: null }
      )
    );

    const response = await POST(createRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      existing: true,
      virtualAccount: { account_number: '9876543210' },
    });
    expect(mockGeneratePaymentAccount).not.toHaveBeenCalled();
  });

  it('returns 500 when checking for an existing DVA fails', async () => {
    authenticateMerchant();
    useOrderQueries({
      paymentAccountError: { message: 'connection reset' },
    });

    const response = await POST(createRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to verify existing payment account');
    expect(mockGeneratePaymentAccount).not.toHaveBeenCalled();
  });

  it('provisions automatic invoice confirmation without creating a pending payment', async () => {
    authenticateMerchant();
    useOrderQueries();
    mockGeneratePaymentAccount.mockResolvedValue(generatedDva);

    const response = await POST(createRequest(), createParams());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.existing).toBe(false);
    expect(body.virtualAccount.account_number).toBe('9876543210');
    expect(body.virtualAccount.bank_name).toBe('Wema Bank');

    expect(mockGeneratePaymentAccount).toHaveBeenCalledWith({
      email: 'john@test.com',
      firstName: 'John',
      lastName: 'Doe',
      phone: '+2348012345678',
      orderId: ORDER_ID,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'reserve_paystack_order_payment_account',
      expect.objectContaining({
        p_account_number: '9876543210',
        p_expected_customer_email: 'john@test.com',
        p_order_id: ORDER_ID,
      })
    );
  });

  it('does not pass a caller-controlled payable amount to reservation', async () => {
    authenticateMerchant();
    useOrderQueries({
      order: {
        ...unpaidOrder,
        amount_paid: '500',
        total: '10000',
        wallet_amount_used: '3000',
      },
      transactions: [
        { amount: '2000', gateway: 'paystack' },
        { amount: '1000', gateway: 'wallet' },
      ],
    });
    mockGeneratePaymentAccount.mockResolvedValue(generatedDva);

    const response = await POST(createRequest(), createParams());

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'reserve_paystack_order_payment_account',
      expect.not.objectContaining({ p_payable_amount: expect.anything() })
    );
  });

  it('does not provision when reconciled payments cover the order', async () => {
    authenticateMerchant();
    useOrderQueries({
      transactions: [{ amount: '5000', gateway: 'paystack' }],
    });
    mockRpc.mockResolvedValueOnce({ data: 0, error: null });

    const response = await POST(createRequest(), createParams());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'NO_PAYABLE_AMOUNT' });
    expect(mockGeneratePaymentAccount).not.toHaveBeenCalled();
  });

  it('returns 502 when Paystack DVA creation fails', async () => {
    authenticateMerchant();
    useOrderQueries();

    mockGeneratePaymentAccount.mockResolvedValue({
      success: false,
      error: 'wema-bank and titan-paycom both failed',
      code: 'DVA_CREATION_FAILED',
    });

    const response = await POST(createRequest(), createParams());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toContain('DVA creation failed');
  });

  it('returns 500 when the automatic confirmation account cannot be persisted', async () => {
    authenticateMerchant();
    useOrderQueries();
    mockGeneratePaymentAccount.mockResolvedValue(generatedDva);
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'reserve_paystack_order_payment_account'
          ? { data: null, error: { message: 'insert failed' } }
          : { data: 5000, error: null }
      )
    );

    const response = await POST(createRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      code: 'PAYMENT_ACCOUNT_PERSIST_FAILED',
      error: 'Failed to save automatic confirmation account',
    });
  });

  it('returns a stable persistence error when the reservation proof cannot be created', async () => {
    authenticateMerchant();
    useOrderQueries();
    mockGeneratePaymentAccount.mockResolvedValue(generatedDva);
    mockCreatePaystackDvaReservationProof.mockImplementationOnce(() => {
      throw new Error('reservation secret unavailable');
    });

    const response = await POST(createRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      code: 'PAYMENT_ACCOUNT_PERSIST_FAILED',
      error: 'Failed to save automatic confirmation account',
    });
    expect(mockRpc).not.toHaveBeenCalledWith(
      'reserve_paystack_order_payment_account',
      expect.anything()
    );
  });
});
