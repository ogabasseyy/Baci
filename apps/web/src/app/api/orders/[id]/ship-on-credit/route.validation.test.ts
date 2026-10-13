import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMalformedJsonRequest,
  createParams,
  createPaymentAccountTable,
  createRequest,
  createSelectSingleQuery,
  createUpdateQuery,
  MERCHANT_ID,
  ORDER_ID,
  postShipOnCredit as POST,
  resetShipOnCreditMocks,
  shipOnCreditMocks,
} from './ship-on-credit.test-support';

const {
  mockAuthenticateApiRequest,
  mockFrom,
  mockGetMerchantIdForApiUser,
  mockLogger,
  mockRpc,
} = shipOnCreditMocks;

describe('POST /api/orders/[id]/ship-on-credit validation', () => {
  beforeEach(resetShipOnCreditMocks);

  it('authenticates before reading a malformed request body', async () => {
    mockAuthenticateApiRequest.mockResolvedValueOnce({
      error: 'Unauthorized',
      user: null,
      supabase: null,
    });

    const response = await POST(createMalformedJsonRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(mockGetMerchantIdForApiUser).not.toHaveBeenCalled();
  });

  it('rejects invalid credit notes before updating the order', async () => {
    const response = await POST(
      createRequest({ credit_notes: { nested: true } }),
      createParams()
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid request body' });
    expect(mockGetMerchantIdForApiUser).not.toHaveBeenCalled();
  });

  it('does not send a synthetic email to Paystack for an order without one', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') {
        return createSelectSingleQuery({
          id: MERCHANT_ID,
          business_name: 'Ogabassey',
        });
      }

      if (table === 'orders') {
        return {
          ...createSelectSingleQuery({
            id: ORDER_ID,
            order_number: 'ORD-001',
            total: '5000',
            customer_name: 'John Doe',
            customer_email: null,
            payment_status: 'unpaid',
            shipping_status: 'pending',
          }),
          ...createUpdateQuery(),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await POST(
      createRequest({ credit_notes: 'Ship now' }),
      createParams()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.virtualAccount).toBeNull();
    expect(shipOnCreditMocks.mockGeneratePaymentAccount).not.toHaveBeenCalled();
  });

  it('returns 500 when checking the current order fails after a no-row update', async () => {
    let orderQueryCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') {
        return createSelectSingleQuery({
          id: MERCHANT_ID,
          business_name: 'Ogabassey',
        });
      }

      if (table === 'orders') {
        orderQueryCount += 1;
        if (orderQueryCount === 1) {
          return createSelectSingleQuery({
            id: ORDER_ID,
            order_number: 'ORD-001',
            total: '5000',
            customer_name: 'John Doe',
            customer_email: 'john@example.com',
            payment_status: 'unpaid',
            shipping_status: 'pending',
          });
        }

        if (orderQueryCount === 2) {
          return createUpdateQuery(null, null);
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'rls failed' },
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await POST(
      createRequest({ credit_notes: 'Ship now' }),
      createParams()
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to verify order status' });
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Database error checking order after credit shipping update matched no rows',
        orderId: ORDER_ID,
      })
    );
  });

  it('keeps ship-on-credit successful when a cross-flow DVA alias conflict has no same-order fallback', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'PAYSTACK_DVA_ALIAS_CONFLICT' },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') {
        return createSelectSingleQuery({
          id: MERCHANT_ID,
          business_name: 'Ogabassey',
        });
      }

      if (table === 'orders') {
        return {
          ...createSelectSingleQuery({
            id: ORDER_ID,
            order_number: 'ORD-001',
            total: '5000',
            customer_name: 'John Doe',
            customer_email: 'john@example.com',
            payment_status: 'unpaid',
            shipping_status: 'pending',
          }),
          ...createUpdateQuery(),
        };
      }

      if (table === 'order_payment_accounts') {
        return createPaymentAccountTable({
          insertError: {
            code: 'P0001',
            message: 'PAYSTACK_DVA_ALIAS_CONFLICT',
          },
          existingAccount: null,
        });
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await POST(
      createRequest({ credit_notes: 'Ship now' }),
      createParams()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      virtualAccount: null,
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Optional credit-order payment account persistence failed after shipping transition',
        orderId: ORDER_ID,
      })
    );
  });

  it('treats duplicate insert conflicts as idempotent success when the existing account is present', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') {
        return createSelectSingleQuery({
          id: MERCHANT_ID,
          business_name: 'Ogabassey',
        });
      }

      if (table === 'orders') {
        return {
          ...createSelectSingleQuery({
            id: ORDER_ID,
            order_number: 'ORD-001',
            total: '5000',
            customer_name: 'John Doe',
            customer_email: 'john@example.com',
            payment_status: 'unpaid',
            shipping_status: 'pending',
          }),
          ...createUpdateQuery(),
        };
      }

      if (table === 'order_payment_accounts') {
        return createPaymentAccountTable({
          insertError: { code: '23505', message: 'duplicate key value' },
          existingAccount: {
            account_number: '0123456789',
            bank_name: 'Wema Bank',
            account_name: 'Ogabassey / John Doe',
          },
        });
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await POST(
      createRequest({ credit_notes: 'Ship now' }),
      createParams()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      message: 'Order confirmed for credit shipping',
      virtualAccount: {
        account_number: '0123456789',
        bank_name: 'Wema Bank',
        account_name: 'Ogabassey / John Doe',
      },
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Order payment account already exists, treating as idempotent success',
        orderId: ORDER_ID,
      })
    );
  });
});
