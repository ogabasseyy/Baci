import { describe, expect, it, vi } from 'vitest';
import { refundClient } from '@/lib/orders/execute-order-cancellation-side-effect.test-support';
import {
  DeferredError,
  DeliveryUncertainError,
} from '@/lib/orders/run-order-cancellation-side-effect';
import {
  customerEmail,
  merchant,
  merchantId,
  order,
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
import { POST as webhook } from './webhook/route';

describe('bank card offer refund', () => {
  it.each([
    ['035', 'Wema Bank', 'Sterling Bank'],
    ['232', 'Sterling Bank', 'Wema Bank'],
  ] as const)('initializes, verifies, and refunds bank %s using the saved offer', async (bankCode, issuer, wrongIssuer) => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'usebaci.com');
    const { data, refundInsert } = setup(bankCode, issuer);
    const input = {
      merchant_id: merchantId,
      order_id: orderId,
      payment_method: 'bank_card_offer',
      amount: 100,
      currency: 'NGN',
      customer_email: customerEmail,
      customer_name: 'Buyer',
      customer_phone: '08012345678',
      gateway: 'paystack',
    };
    const started = await initialize(request('initialize', input));
    expect(started.status, await started.clone().text()).toBe(200);
    expect(mocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        reference,
        amount: 9500,
        callback_url: `https://ogabassey.usebaci.com/checkout/success?reference=${reference}`,
        metadata: expect.objectContaining({
          custom_filters: { banks: [bankCode], card_brands: ['visa'] },
        }),
      })
    );
    expect((await initialize(request('initialize', input))).status).toBe(200);
    expect(mocks.initialize).toHaveBeenCalledTimes(1);

    const wrong = {
      ...data,
      authorization: { ...data.authorization, bank: wrongIssuer },
    };
    mocks.verify.mockResolvedValue({ success: true, data: wrong });
    const ignored = await webhook(
      request('webhook', { event: 'charge.success', data: wrong }, true)
    );
    expect(ignored.status, await ignored.clone().text()).toBe(200);
    await expect(ignored.json()).resolves.toMatchObject({
      code: 'BANK_CARD_OFFER_CAPTURE_REVIEW',
    });
    expect(refundInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        paystack_ref: reference,
        metadata: { source: 'bank_card_offer_capture' },
      })
    );
    mocks.verify.mockResolvedValue({
      success: true,
      data: { ...data, reference: 'different-reference' },
    });
    const mismatchedReference = await verify(request('verify', { reference }));
    expect(mismatchedReference.status).toBe(202);
    await expect(mismatchedReference.json()).resolves.toMatchObject({
      code: 'BANK_CARD_OFFER_CAPTURE_REVIEW',
    });

    mocks.verify.mockResolvedValue({ success: false, code: 'NETWORK_ERROR' });
    expect(
      (
        await webhook(
          request('webhook', { event: 'charge.success', data }, true)
        )
      ).status
    ).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );

    mocks.verify.mockResolvedValue({ success: true, data });
    const callCallback = () => verify(request('verify', { reference }));
    const callWebhook = () =>
      webhook(request('webhook', { event: 'charge.success', data }, true));
    const providerCallsBeforeSuccess = mocks.verify.mock.calls.length;
    const callback = bankCode === '035' ? await callCallback() : null;
    const delivered = await callWebhook();
    expect(delivered.status, await delivered.clone().text()).toBe(200);
    const verifiedCallback = callback ?? (await callCallback());
    expect(verifiedCallback.status, await verifiedCallback.clone().text()).toBe(
      200
    );
    expect(await verifiedCallback.json()).toMatchObject({
      success: true,
      finalizationOutcome: 'completed',
    });
    expect(mocks.verify).toHaveBeenCalledTimes(providerCallsBeforeSuccess + 2);
    mocks.verify.mockResolvedValue({ success: false, code: 'NETWORK_ERROR' });
    expect((await callCallback()).status).toBe(503);
    expect((await callWebhook()).status).toBe(503);
    expect(mocks.verify).toHaveBeenCalledTimes(providerCallsBeforeSuccess + 4);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'approve_bank_card_offer_capture',
      expect.objectContaining({
        p_evidence: expect.objectContaining({
          issuerName: issuer,
          amountKobo: 9500,
          reference,
        }),
      })
    );

    mocks.verify.mockResolvedValue({
      success: true,
      data: { ...data, id: String(data.id) },
    });
    const { executeOrderCancellationSideEffect } = await import(
      '@/lib/orders/execute-order-cancellation-side-effect'
    );
    await expect(
      executeOrderCancellationSideEffect({
        claimToken: 'refund-claim',
        merchant,
        order: { ...order, payment_status: 'paid' },
        step: 'refund',
        supabase: mocks as never,
      })
    ).resolves.toEqual({ refundIds: [64] });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'get_bank_card_offer_refundable_amount',
      {
        p_order_id: orderId,
        p_merchant_id: merchantId,
        p_transaction_id: transactionId,
        p_reference: reference,
      }
    );
    expect(mocks.refund).toHaveBeenCalledWith(
      reference,
      9500,
      'Order cancelled',
      undefined
    );
    expect(refundInsert).toHaveBeenCalledWith(
      expect.objectContaining({ gateway_reference: '64' })
    );
  });

  it.each([
    {
      gateway: 'manual',
      metadata: { payment_transaction_id: transactionId },
      outcome: DeferredError,
    },
    {
      gateway: 'paystack',
      metadata: {
        payment_transaction_id: transactionId,
        provider_refund_status: 'processed',
      },
      outcome: DeliveryUncertainError,
    },
  ])('never sends a full refund after a $gateway partial-item refund', async ({
    gateway,
    metadata,
    outcome,
  }) => {
    const { data } = setup('035', 'Wema Bank');
    const checkout = await verify(request('verify', { reference }));
    expect(checkout.status).toBe(200);
    await expect(checkout.json()).resolves.toMatchObject({
      finalizationOutcome: 'completed',
      orderId,
    });

    // The saved capture remains eligible for a whole-order refund. A
    // recorded item refund covers only part of it and must block dispatch
    // before the worker reads or submits the full captured amount.
    mocks.rpc.mockClear();
    mocks.verify.mockResolvedValue({
      success: true,
      data: { ...data, id: String(data.id) },
    });
    const payment = {
      id: transactionId,
      status: 'completed',
      amount: 95,
      currency: 'NGN',
      gateway: 'paystack',
      gateway_reference: reference,
    };
    const ledger = refundClient({
      payments: [payment],
      refundRows: [
        {
          amount: 47.5,
          currency: 'NGN',
          gateway,
          metadata,
          status: 'completed',
        },
      ],
    });
    const { executeOrderCancellationSideEffect } = await import(
      '@/lib/orders/execute-order-cancellation-side-effect'
    );
    const result = await executeOrderCancellationSideEffect({
      claimToken: 'refund-claim',
      merchant,
      order: { ...order, payment_status: 'paid' },
      step: 'refund',
      supabase: { from: ledger.from, rpc: mocks.rpc } as never,
    }).catch((error: unknown) => error);
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'begin_bank_card_offer_refund_dispatch',
      expect.anything()
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'get_bank_card_offer_refundable_amount',
      expect.anything()
    );
    expect(result).toBeInstanceOf(outcome);
  });
});
