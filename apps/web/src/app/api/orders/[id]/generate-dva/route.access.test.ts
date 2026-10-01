import { beforeEach, describe, expect, it } from 'vitest';
import {
  authenticateMerchant,
  createParams,
  createRequest,
  generateDvaTestMocks,
  MERCHANT_ID,
  ORDER_ID,
  postGenerateDva as POST,
  resetGenerateDvaMocks,
  unpaidOrder,
  useOrderQueries,
} from './generate-dva-test-support';

const {
  mockAuthenticateApiRequest,
  mockGeneratePaymentAccount,
  mockGetUserAccess,
  mockRpc,
} = generateDvaTestMocks;

describe('POST /api/orders/[id]/generate-dva access and reuse', () => {
  beforeEach(resetGenerateDvaMocks);

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });

    const response = await POST(createRequest(), createParams());
    expect(response.status).toBe(401);
  });

  it('returns 404 when merchant not found', async () => {
    authenticateMerchant(null);

    const response = await POST(createRequest(), createParams());
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('Merchant not found');
  });

  it('returns 400 for an invalid order ID', async () => {
    authenticateMerchant();

    const response = await POST(createRequest(), createParams('not-an-id'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'INVALID_ORDER_ID',
      error: 'Invalid order ID',
    });
    expect(mockGetUserAccess).not.toHaveBeenCalled();
  });

  it('returns 404 when order not found', async () => {
    authenticateMerchant();
    useOrderQueries({
      order: null,
      orderError: { code: 'PGRST116', message: 'Not found' },
    });

    const response = await POST(createRequest(), createParams());
    expect(response.status).toBe(404);
  });

  it('returns 400 when order is already paid', async () => {
    authenticateMerchant();
    useOrderQueries({
      order: { ...unpaidOrder, payment_status: 'paid' },
    });

    const response = await POST(createRequest(), createParams());
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Order is already paid');
  });

  it('rejects non-NGN orders before provisioning a Paystack account', async () => {
    authenticateMerchant();
    useOrderQueries({ order: { ...unpaidOrder, currency: 'USD' } });

    const response = await POST(createRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('UNSUPPORTED_CURRENCY');
    expect(mockGeneratePaymentAccount).not.toHaveBeenCalled();
  });

  it('rejects orders without a customer email because the webhook cannot match them', async () => {
    authenticateMerchant();
    useOrderQueries({ order: { ...unpaidOrder, customer_email: null } });

    const response = await POST(createRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('CUSTOMER_EMAIL_REQUIRED');
    expect(mockGeneratePaymentAccount).not.toHaveBeenCalled();
  });

  it('rejects automatic confirmation when Paystack is disabled', async () => {
    authenticateMerchant();
    useOrderQueries({ featureSettings: { paystack_enabled: false } });

    const response = await POST(createRequest(), createParams());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'GATEWAY_DISABLED' });
    expect(mockGeneratePaymentAccount).not.toHaveBeenCalled();
  });

  it.each([
    ['refunded', { payment_status: 'refunded' }],
    ['failed', { payment_status: 'failed' }],
    ['bnpl', { payment_status: 'bnpl_pending' }],
    ['cancelled shipping', { shipping_status: 'cancelled' }],
    ['cancelled timestamp', { cancelled_at: '2026-08-24T12:00:00.000Z' }],
  ])('rejects %s orders', async (_label, overrides) => {
    authenticateMerchant();
    useOrderQueries({ order: { ...unpaidOrder, ...overrides } });

    const response = await POST(createRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('ORDER_NOT_ELIGIBLE_FOR_DVA');
    expect(mockGeneratePaymentAccount).not.toHaveBeenCalled();
  });

  it('returns existing DVA when one already exists', async () => {
    authenticateMerchant();
    useOrderQueries({
      paymentAccount: {
        account_number: '1234567890',
        bank_name: 'Wema Bank',
        account_name: 'Ogabassey/John Doe',
      },
    });

    const response = await POST(createRequest(), createParams());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.existing).toBe(true);
    expect(body.virtualAccount.account_number).toBe('1234567890');
    expect(mockRpc).toHaveBeenCalledWith(
      'refresh_paystack_order_payable_amount',
      { p_order_id: ORDER_ID }
    );
  });

  it('returns an existing DVA to staff with view-only order access', async () => {
    authenticateMerchant();
    mockGetUserAccess.mockResolvedValue({
      isOwner: false,
      isStaff: true,
      merchantId: MERCHANT_ID,
      permissions: { orders: { view: true } },
      role: 'staff',
    });
    useOrderQueries({
      paymentAccount: {
        account_number: '1234567890',
        bank_name: 'Wema Bank',
        account_name: 'Ogabassey/John Doe',
      },
    });

    const response = await POST(createRequest(), createParams());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ existing: true });
    expect(mockGeneratePaymentAccount).not.toHaveBeenCalled();
  });

  it('does not provision a new DVA for staff with view-only order access', async () => {
    authenticateMerchant();
    mockGetUserAccess.mockResolvedValue({
      isOwner: false,
      isStaff: true,
      merchantId: MERCHANT_ID,
      permissions: { orders: { view: true } },
      role: 'staff',
    });
    useOrderQueries();

    const response = await POST(createRequest(), createParams());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'FORBIDDEN',
      error: 'Forbidden',
    });
    expect(mockGeneratePaymentAccount).not.toHaveBeenCalled();
  });

  it('returns a legacy provider account instead of creating a second row', async () => {
    authenticateMerchant();
    const paymentAccountQuery = useOrderQueries();
    paymentAccountQuery.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          account_number: '1234567890',
          bank_name: 'Kora Bank',
          account_name: 'Ogabassey/John Doe',
          provider: 'korapay',
        },
        error: null,
      });

    const response = await POST(createRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.existing).toBe(true);
    expect(body.virtualAccount.account_number).toBe('1234567890');
    expect(mockGeneratePaymentAccount).not.toHaveBeenCalled();
  });
});
