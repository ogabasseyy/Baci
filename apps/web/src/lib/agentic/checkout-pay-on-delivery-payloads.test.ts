import { describe, expect, it } from 'vitest';
import type { AgenticCheckoutBuyer } from '@/lib/agentic/checkout-completion-response';
import {
  buildPayOnDeliveryCheckoutResponse,
  buildPayOnDeliveryCompletedSessionUpdate,
  buildPayOnDeliveryOrderPayload,
} from '@/lib/agentic/checkout-pay-on-delivery-payloads';

type TestCheckoutCalculation = Parameters<
  typeof buildPayOnDeliveryOrderPayload
>[0]['sessionCalc'];

const buyer: AgenticCheckoutBuyer = {
  email: 'buyer@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  phone_number: '+2348012345678',
};

const sessionCalc: TestCheckoutCalculation = {
  fulfillmentOptions: [],
  lineItems: [
    {
      base_amount: 500000,
      discount: 0,
      id: 'line_product-1',
      item: {
        id: 'product-1',
        product_id: 'product-1',
        quantity: 1,
        title: 'Phone',
      },
      subtotal: 500000,
      tax: 0,
      total: 500000,
    },
  ],
  messages: [],
  selectedOptionId: 'pickup_store_1',
  totals: [
    { amount: 500000, display_text: 'Subtotal', type: 'subtotal' as const },
    { amount: 1500, display_text: 'Delivery', type: 'fulfillment' as const },
    { amount: 501500, display_text: 'Total', type: 'total' as const },
  ],
};

describe('pay-on-delivery agentic checkout payloads', () => {
  it('builds a pending pay-on-delivery storefront order payload', () => {
    const payload = buildPayOnDeliveryOrderPayload({
      buyer,
      session: {
        merchant_id: 'merchant-1',
        session_id: 'agentic_session_1',
        shipping_address: { city: 'Lagos' },
      },
      sessionCalc,
    });

    expect(payload).toMatchObject({
      customer_email: 'buyer@example.com',
      customer_name: 'Ada Lovelace',
      customer_phone: '+2348012345678',
      merchant_id: 'merchant-1',
      payment_method: 'pay_on_delivery',
      payment_status: 'pending',
      shipping_fee: 1500,
      shipping_status: 'pending',
      source: 'agentic_ai',
      subtotal: 500000,
    });
    expect(payload.items).toEqual([
      {
        name: 'Phone',
        price: 500000,
        product_id: 'product-1',
        quantity: 1,
      },
    ]);
  });

  it('sends unit prices and the purchased condition for multi-quantity lines', () => {
    const payload = buildPayOnDeliveryOrderPayload({
      buyer,
      session: {
        merchant_id: 'merchant-1',
        session_id: 'agentic_session_1',
        shipping_address: { city: 'Lagos' },
      },
      sessionCalc: {
        ...sessionCalc,
        lineItems: [
          {
            ...sessionCalc.lineItems[0],
            base_amount: 900000,
            item: {
              ...sessionCalc.lineItems[0].item,
              condition: 'used',
              quantity: 3,
            },
          },
        ],
      } as never,
    });
    expect(payload.items[0]).toMatchObject({
      condition: 'used',
      price: 300000,
      quantity: 3,
    });
  });

  it('builds completed checkout session updates and agent response bodies', () => {
    const update = buildPayOnDeliveryCompletedSessionUpdate({
      buyer,
      metadata: {
        agentic: {
          existing: true,
          finalization_claim: 'claim-1',
          finalization_error: 'previous failure',
          finalization_order_id: 'order-1',
          finalization_updated_at: '2026-05-09T12:00:00.000Z',
        },
      },
      orderId: 'order-1',
    });
    const response = buildPayOnDeliveryCheckoutResponse({
      buyer,
      orderId: 'order-1',
      session: {
        currency: 'NGN',
        session_id: 'agentic_session_1',
        shipping_address: { city: 'Lagos' },
      },
      sessionCalc,
    });

    expect(update).toMatchObject({
      order_id: 'order-1',
      payment_method: 'pay_on_delivery',
      payment_provider: null,
      payment_reference: null,
      status: 'completed',
    });
    expect(update.metadata).toMatchObject({
      agentic: {
        existing: true,
        payment_method: 'pay_on_delivery',
        payment_state: 'pay_on_delivery_pending',
      },
    });
    expect(update.metadata.agentic).not.toHaveProperty('finalization_claim');
    expect(update.metadata.agentic).not.toHaveProperty('finalization_error');
    expect(update.metadata.agentic).not.toHaveProperty('finalization_order_id');
    expect(update.metadata.agentic).not.toHaveProperty(
      'finalization_updated_at'
    );
    expect(response).toMatchObject({
      currency: 'ngn',
      id: 'agentic_session_1',
      order: { id: 'order-1', status: 'payment_pending' },
      payment_details: { type: 'pay_on_delivery' },
      status: 'completed',
    });
  });
});
