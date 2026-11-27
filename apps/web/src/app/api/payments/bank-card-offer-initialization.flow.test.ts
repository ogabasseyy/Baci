import { describe, expect, it, vi } from 'vitest';
import {
  customerEmail,
  merchantId,
  orderId,
  reference,
  request,
  secret,
  setup,
  transactionId,
} from './bank-card-offer-flow.test-support';
import { mocks } from './bank-card-offer-flow-mocks.test-support';
import { POST as initialize } from './initialize/route';
import { POST as verify } from './verify/route';

describe('bank card offer initialization', () => {
  it('requires CSRF proof before reserving a bank-offer checkout', async () => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    setup('035', 'Wema Bank');
    mocks.csrf.mockResolvedValueOnce({ valid: false });

    const response = await initialize(
      request('initialize', {
        merchant_id: merchantId,
        order_id: orderId,
        payment_method: 'bank_card_offer',
        currency: 'NGN',
        customer_email: customerEmail,
        customer_name: 'Buyer',
        customer_phone: '08012345678',
        gateway: 'paystack',
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it.each([
    'provider timeout',
    'save rejected',
    'incorrect amount echoed',
  ] as const)('opens a recovery review after %s without another provider call', async (failure) => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    setup('035', 'Wema Bank', undefined, failure !== 'save rejected');
    if (failure === 'provider timeout') {
      mocks.initialize.mockRejectedValueOnce(new Error('Connection closed'));
    }
    if (failure === 'incorrect amount echoed') {
      mocks.initialize.mockResolvedValueOnce({
        reference,
        authorization_url: 'https://checkout.paystack.com/trx/example',
        amount: 9501,
      });
    }
    const input = {
      merchant_id: merchantId,
      order_id: orderId,
      payment_method: 'bank_card_offer',
      currency: 'NGN',
      customer_email: customerEmail,
      customer_name: 'Buyer',
      customer_phone: '08012345678',
      gateway: 'paystack',
    };
    expect((await initialize(request('initialize', input))).status).toBe(202);
    expect((await initialize(request('initialize', input))).status).toBe(202);
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'request_bank_card_offer_initialization_review',
      expect.objectContaining({ p_reference: reference, p_failed: true })
    );
    expect(
      mocks.rpc.mock.calls.filter(
        ([name]) => name === 'record_bank_card_offer_checkout_url'
      )
    ).toHaveLength(failure === 'save rejected' ? 1 : 0);
  });

  it.each([
    { status: 'failed', amount: 9500 },
    { status: 'abandoned', amount: 9500 },
    { status: 'cancelled', amount: 9500 },
    { status: 'reversed', amount: 9500 },
    { status: 'failed', amount: 1 },
  ])('holds the attempt after $status with a reported amount of $amount kobo', async ({
    status,
    amount,
  }) => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    const { data } = setup('035', 'Wema Bank');
    const input = {
      merchant_id: merchantId.toUpperCase(),
      order_id: orderId,
      payment_method: 'bank_card_offer',
      currency: 'NGN',
      customer_email: customerEmail,
      customer_name: 'Buyer',
      customer_phone: '08012345678',
      gateway: 'paystack',
    };
    expect((await initialize(request('initialize', input))).status).toBe(200);

    mocks.verify.mockResolvedValue({
      success: true,
      data: { ...data, status, amount },
    });
    const callback = await verify(request('verify', { reference }));
    expect(callback.status).toBe(200);
    await expect(callback.json()).resolves.toMatchObject({
      success: false,
      status,
      orderId,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'flag_bank_card_offer_terminal_review',
      expect.objectContaining({
        p_transaction_id: transactionId,
        p_status: status,
      })
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );

    const repeated = await initialize(request('initialize', input));
    expect(repeated.status).toBe(202);
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
  });
});
