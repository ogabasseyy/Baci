import { describe, expect, it } from 'vitest';
import {
  buildAgenticCheckoutOrderPayload,
  buildPaymentPendingSessionUpdate,
  readAgenticSharedCartBinding,
} from '@/lib/agentic/checkout-completion-payloads';

const buyer = {
  email: 'buyer@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  phone_number: '+2348012345678',
};

const dvaAccount = {
  account_name: 'Baci Test',
  account_number: '1234567890',
  bank_name: 'Paystack-Titan',
};

const sessionCalc = {
  lineItems: [
    {
      id: 'line_product-1',
      item: {
        id: 'product-1',
        product_id: 'product-1',
        quantity: 1,
        title: 'Phone',
      },
      base_amount: 500000,
      discount: 0,
      subtotal: 500000,
      tax: 0,
      total: 500000,
    },
  ],
  totals: [
    {
      type: 'items_base_amount' as const,
      display_text: 'Items',
      amount: 500000,
    },
    { type: 'fulfillment' as const, display_text: 'Delivery', amount: 2500 },
    { type: 'total' as const, display_text: 'Total', amount: 502500 },
  ],
  fulfillmentOptions: [],
  selectedOptionId: 'pickup_store_1',
  messages: [],
};

describe('agentic checkout completion payloads', () => {
  it('builds an internal order payload with named items and stored totals', () => {
    const payload = buildAgenticCheckoutOrderPayload({
      buyer,
      dvaAccount,
      session: {
        merchant_id: 'merchant-1',
        session_id: 'agentic_session_1',
        shipping_address: { city: 'Lagos' },
      },
      sessionCalc,
    });

    expect(payload).toMatchObject({
      merchant_id: 'merchant-1',
      customer_email: 'buyer@example.com',
      items: [
        {
          name: 'Phone',
          product_id: 'product-1',
          quantity: 1,
          price: 500000,
        },
      ],
      subtotal: 500000,
      shipping_fee: 2500,
      payment_provider_reference: '1234567890',
    });
    expect(payload.notes).toContain('****7890');
    expect(payload.notes).not.toContain('1234567890');
  });

  it('builds a checkout_sessions update using real payment columns', () => {
    const payload = buildPaymentPendingSessionUpdate({
      buyer,
      dvaAccount,
      metadata: { agentic: { line_items: [] } },
      orderId: 'order-1',
    });

    expect(payload).toMatchObject({
      status: 'processing',
      order_id: 'order-1',
      customer_email: 'buyer@example.com',
      payment_provider: 'paystack',
      payment_reference: '1234567890',
      virtual_account_number: '1234567890',
      metadata: {
        agentic: {
          buyer,
          payment_state: 'payment_pending',
        },
      },
    });
  });

  it('keeps variant orders tied to parent products', () => {
    const payload = buildAgenticCheckoutOrderPayload({
      buyer,
      dvaAccount,
      session: {
        merchant_id: 'merchant-1',
        session_id: 'agentic_session_1',
      },
      sessionCalc: {
        ...sessionCalc,
        lineItems: [
          {
            ...sessionCalc.lineItems[0],
            item: {
              id: 'variant-1',
              product_id: 'product-1',
              quantity: 1,
              title: 'Phone - Black',
              variant_attributes: { color: 'Black' },
              variant_id: 'variant-1',
            },
          },
        ],
      },
    });

    expect(payload.items[0]).toMatchObject({
      product_id: 'product-1',
      variant_attributes: { color: 'Black' },
      variant_id: 'variant-1',
    });
  });

  it('normalizes buyer names without adding stray whitespace', () => {
    const payload = buildPaymentPendingSessionUpdate({
      buyer: {
        ...buyer,
        first_name: 'Ada',
        last_name: '',
      },
      dvaAccount,
      metadata: {},
      orderId: 'order-1',
    });

    expect(payload.customer_name).toBe('Ada');
  });
});

describe('readAgenticSharedCartBinding', () => {
  const COMPLETE = {
    cart_id: '223e4567-e89b-12d3-a456-426614174000',
    cart_version: 3,
    checkout_generation: 1,
    checkout_session_id: '323e4567-e89b-12d3-a456-426614174000',
  };

  it('reads a complete binding from session metadata', () => {
    expect(
      readAgenticSharedCartBinding({
        agentic: { shared_cart: COMPLETE },
      })
    ).toEqual(COMPLETE);
  });

  it('returns null for linkage-only metadata without a prepared session', () => {
    expect(
      readAgenticSharedCartBinding({
        agentic: { shared_cart: { cart_id: COMPLETE.cart_id } },
      })
    ).toBeNull();
  });

  it('returns null for malformed bindings', () => {
    expect(readAgenticSharedCartBinding({})).toBeNull();
    expect(readAgenticSharedCartBinding(null)).toBeNull();
    expect(
      readAgenticSharedCartBinding({
        agentic: {
          shared_cart: { ...COMPLETE, checkout_generation: 0 },
        },
      })
    ).toBeNull();
    expect(
      readAgenticSharedCartBinding({
        agentic: {
          shared_cart: { ...COMPLETE, checkout_session_id: '' },
        },
      })
    ).toBeNull();
  });
});
