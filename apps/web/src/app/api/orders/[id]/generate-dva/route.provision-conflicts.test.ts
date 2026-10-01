import { beforeEach, describe, expect, it } from 'vitest';
import {
  authenticateMerchant,
  createParams,
  createRequest,
  generateDvaTestMocks,
  generatedDva,
  postGenerateDva as POST,
  resetGenerateDvaMocks,
  useOrderQueries,
} from './generate-dva-test-support';

const { mockGeneratePaymentAccount, mockRpc } = generateDvaTestMocks;

describe('POST /api/orders/[id]/generate-dva reservation conflicts', () => {
  beforeEach(resetGenerateDvaMocks);

  it.each([
    'conflict',
    'wallet_conflict',
  ])('does not persist a Paystack account with reservation status %s', async (reservationStatus) => {
    authenticateMerchant();
    useOrderQueries();
    mockGeneratePaymentAccount.mockResolvedValue(generatedDva);
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve({
        data:
          name === 'reserve_paystack_order_payment_account'
            ? reservationStatus
            : 5000,
        error: null,
      })
    );

    const response = await POST(createRequest(), createParams());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'PAYSTACK_DVA_IN_USE',
    });
    expect(mockRpc).toHaveBeenCalledWith(
      'reserve_paystack_order_payment_account',
      expect.any(Object)
    );
  });

  it('rejects a reservation when the order became ineligible at insert time', async () => {
    authenticateMerchant();
    useOrderQueries();
    mockGeneratePaymentAccount.mockResolvedValue(generatedDva);
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve({
        data:
          name === 'reserve_paystack_order_payment_account'
            ? 'ineligible'
            : 5000,
        error: null,
      })
    );

    const response = await POST(createRequest(), createParams());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'ORDER_NOT_ELIGIBLE_FOR_DVA',
    });
  });

  it('rejects a reservation when the customer email changes during provisioning', async () => {
    authenticateMerchant();
    useOrderQueries();
    mockGeneratePaymentAccount.mockResolvedValue(generatedDva);
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve({
        data:
          name === 'reserve_paystack_order_payment_account'
            ? 'customer_changed'
            : 5000,
        error: null,
      })
    );

    const response = await POST(createRequest(), createParams());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'ORDER_CUSTOMER_CHANGED',
    });
  });

  it('returns 409 when the cross-flow alias trigger rejects the account', async () => {
    authenticateMerchant();
    useOrderQueries();
    mockGeneratePaymentAccount.mockResolvedValue(generatedDva);
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'reserve_paystack_order_payment_account'
          ? {
              data: null,
              error: { message: 'PAYSTACK_DVA_ALIAS_CONFLICT' },
            }
          : { data: 5000, error: null }
      )
    );

    const response = await POST(createRequest(), createParams());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'PAYSTACK_DVA_IN_USE',
    });
  });

  it('returns the atomic reservation winner for concurrent same-order requests', async () => {
    authenticateMerchant();
    useOrderQueries();
    mockGeneratePaymentAccount.mockResolvedValue(generatedDva);
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve({
        data:
          name === 'reserve_paystack_order_payment_account' ? 'existing' : 5000,
        error: null,
      })
    );

    const response = await POST(createRequest(), createParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.existing).toBe(true);
    expect(body.virtualAccount.account_number).toBe('9876543210');
  });
});
