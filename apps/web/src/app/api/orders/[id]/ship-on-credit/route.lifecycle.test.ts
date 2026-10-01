import { beforeEach, describe, expect, it } from 'vitest';
import {
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
  mockFrom,
  mockGeneratePaymentAccount,
  mockLogger,
  mockRpc,
  mockReconciliationInsert,
} = shipOnCreditMocks;

describe('POST /api/orders/[id]/ship-on-credit account lifecycle', () => {
  beforeEach(resetShipOnCreditMocks);

  it('does not return an expired Paystack alias after a duplicate insert conflict', async () => {
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
            customer_email: 'new-email@example.com',
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
            account_name: 'Ogabassey / Old Customer',
            assigned_at: '2020-01-01T00:00:00.000Z',
            expires_at: '2020-01-01T00:30:00.000Z',
            provider: 'paystack',
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
      virtualAccount: null,
    });
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Order payment account already exists, treating as idempotent success',
      })
    );
  });

  it('files reconciliation and rejects when the order was clamped as cancelled', async () => {
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
          // The update returns the CLAMPED cancelled row.
          ...createUpdateQuery(null, {
            id: ORDER_ID,
            shipping_status: 'cancelled',
            cancelled_at: '2026-06-15T00:00:00Z',
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

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: 'Order was cancelled and cannot be shipped on credit',
      code: 'ORDER_CANCELLED',
    });
    // The reconciliation row is filed through the service-role admin client.
    expect(mockReconciliationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'payment_received_after_cancellation',
        order_id: ORDER_ID,
      })
    );
    // No DVA was created for the cancelled order.
    expect(mockGeneratePaymentAccount).not.toHaveBeenCalled();
  });

  it('keeps ship-on-credit successful when the optional fallback lookup fails', async () => {
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
          existingAccountError: { message: 'read failed' },
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
          'Optional credit-order payment account lookup failed after shipping transition',
        orderId: ORDER_ID,
      })
    );
  });
});
