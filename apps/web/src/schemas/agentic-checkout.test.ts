import { describe, expect, it } from 'vitest';
import {
  agenticCheckoutCompleteSchema,
  agenticCheckoutUpdateSchema,
  cancelAgenticCheckoutSessionInputSchema,
  checkoutSessionSchema,
  createAgenticCheckoutSessionInputSchema,
  getAgenticCheckoutSessionInputSchema,
  updateAgenticCheckoutSessionInputSchema,
} from '@/schemas/agentic-checkout';

describe('checkoutSessionSchema', () => {
  it('accepts a valid checkout session payload', () => {
    const result = checkoutSessionSchema.safeParse({
      items: [{ id: 'product-1', quantity: 2 }],
      currency: 'ngn',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe('NGN');
    }
  });

  it('accepts a UCP cart id checkout creation payload', () => {
    const result = checkoutSessionSchema.safeParse({ cart_id: 'cart_123' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        cart_id: 'cart_123',
        currency: 'NGN',
      });
    }
  });

  it('rejects a blank UCP cart id checkout creation payload', () => {
    const result = checkoutSessionSchema.safeParse({ cart_id: '   ' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === 'cart_id')
      ).toBe(true);
    }
  });

  it('accepts ACP line_items as a checkout session payload alias', () => {
    const result = checkoutSessionSchema.safeParse({
      capabilities: {},
      currency: 'ngn',
      line_items: [{ id: 'product-1', quantity: 2 }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        currency: 'NGN',
        items: [{ id: 'product-1', quantity: 2 }],
      });
      expect(result.data).not.toHaveProperty('line_items');
    }
  });

  it('accepts native ACP item-shaped line_items and defaults quantity to one', () => {
    const result = checkoutSessionSchema.safeParse({
      capabilities: {},
      currency: 'ngn',
      fulfillment_details: {
        name: 'Ada Buyer',
        phone_number: '+2348012345678',
        email: 'ada@example.com',
        address: {
          name: 'Ada Buyer',
          line_one: '12 Example Street',
          line_two: 'Flat 3',
          city: 'Lagos',
          state: 'LA',
          country: 'NG',
          postal_code: '100001',
        },
      },
      line_items: [{ id: 'product-1' }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        items: [{ id: 'product-1', quantity: 1 }],
        shipping_address: {
          address: '12 Example Street, Flat 3',
          city: 'Lagos',
          country_code: 'NG',
          email: 'ada@example.com',
          name: 'Ada Buyer',
          phone: '+2348012345678',
          postal_code: '100001',
          state: 'LA',
        },
      });
      expect(result.data).not.toHaveProperty('fulfillment_details');
    }
  });

  it('accepts nested ACP item identifiers in line_items', () => {
    const result = checkoutSessionSchema.safeParse({
      capabilities: {},
      currency: 'ngn',
      line_items: [
        { id: 'line_product-1', item: { id: 'product-1' }, quantity: 2 },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        items: [{ id: 'product-1', quantity: 2 }],
      });
    }
  });

  it('constructs shipping_address from sparse ACP fulfillment_details address fields', () => {
    const result = checkoutSessionSchema.safeParse({
      items: [{ id: 'product-1', quantity: 1 }],
      fulfillment_details: {
        address: {
          line_one: '12 Example Street',
          city: 'Lagos',
          state: 'LA',
          country: 'NG',
          postal_code: '100001',
        },
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        shipping_address: {
          address: '12 Example Street',
          city: 'Lagos',
          country_code: 'NG',
          postal_code: '100001',
          state: 'LA',
        },
      });
      expect(result.data).not.toHaveProperty('fulfillment_details');
    }
  });

  it('keeps legacy items when items and line_items are both provided', () => {
    const result = checkoutSessionSchema.safeParse({
      items: [{ id: 'product-1', quantity: 1 }],
      line_items: [{ id: 'product-2', quantity: 2 }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        items: [{ id: 'product-1', quantity: 1 }],
      });
    }
  });

  it.each([
    { line_items: [] },
    { line_items: [{ quantity: 1 }] },
    { line_items: [{ id: 'product-1', quantity: '2' }] },
  ])('rejects invalid ACP line_items payloads %#', (payload) => {
    const result = checkoutSessionSchema.safeParse(payload);

    expect(result.success).toBe(false);
  });

  it('rejects an empty items array', () => {
    const result = checkoutSessionSchema.safeParse({
      items: [],
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid item quantities', () => {
    const result = checkoutSessionSchema.safeParse({
      items: [{ id: 'product-1', quantity: 0 }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only item identifiers', () => {
    const result = checkoutSessionSchema.safeParse({
      items: [{ id: '   ', quantity: 1 }],
    });

    expect(result.success).toBe(false);
  });
});

describe('createAgenticCheckoutSessionInputSchema', () => {
  it('accepts an MCP checkout session payload with an idempotency key', () => {
    const result = createAgenticCheckoutSessionInputSchema.safeParse({
      currency: 'ngn',
      idempotency_key: 'idem-checkout-1',
      items: [{ id: 'product-1', quantity: 2 }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe('NGN');
      expect(result.data.idempotency_key).toBe('idem-checkout-1');
    }
  });

  it('accepts ACP line_items in an MCP checkout session payload', () => {
    const result = createAgenticCheckoutSessionInputSchema.safeParse({
      currency: 'ngn',
      idempotency_key: 'idem-checkout-1',
      line_items: [{ id: 'product-1', quantity: 2 }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([{ id: 'product-1', quantity: 2 }]);
    }
  });

  it('keeps MCP items when items and line_items are both provided', () => {
    const result = createAgenticCheckoutSessionInputSchema.safeParse({
      idempotency_key: 'idem-checkout-1',
      items: [{ id: 'product-1', quantity: 1 }],
      line_items: [{ id: 'product-2', quantity: 2 }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([{ id: 'product-1', quantity: 1 }]);
    }
  });

  it('rejects item quantities above the MCP checkout limit', () => {
    const result = createAgenticCheckoutSessionInputSchema.safeParse({
      idempotency_key: 'idem-checkout-1',
      items: [{ id: 'product-1', quantity: 21 }],
    });

    expect(result.success).toBe(false);
  });

  it.each([
    { line_items: [{ id: 'product-1', quantity: 21 }] },
    { line_items: [{ quantity: 1 }] },
    { line_items: [{ id: 'product-1', quantity: -1 }] },
  ])('rejects invalid MCP line_items payloads %#', (payload) => {
    const result = createAgenticCheckoutSessionInputSchema.safeParse({
      idempotency_key: 'idem-checkout-1',
      ...payload,
    });

    expect(result.success).toBe(false);
  });
});

describe('agenticCheckoutUpdateSchema', () => {
  it('accepts a valid update payload', () => {
    const result = agenticCheckoutUpdateSchema.safeParse({
      fulfillment_option_id: 'shipping_standard',
      shipping_address: {
        address: '12 Example Street',
        city: 'Lagos',
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts ACP line_items as an update payload alias', () => {
    const result = agenticCheckoutUpdateSchema.safeParse({
      capabilities: {},
      line_items: [{ id: 'product-1', quantity: 2 }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([{ id: 'product-1', quantity: 2 }]);
    }
  });

  it('accepts native ACP fulfillment_details and selected_fulfillment_options aliases', () => {
    const result = agenticCheckoutUpdateSchema.safeParse({
      fulfillment_details: {
        name: 'Ada Buyer',
        address: {
          line_one: '12 Example Street',
          city: 'Lagos',
          state: 'LA',
          country: 'NG',
          postal_code: '100001',
        },
      },
      selected_fulfillment_options: [
        {
          type: 'shipping',
          option_id: 'shipping_standard',
          item_ids: ['line_product-1'],
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        fulfillment_option_id: 'shipping_standard',
        shipping_address: {
          address: '12 Example Street',
          city: 'Lagos',
          country_code: 'NG',
          name: 'Ada Buyer',
          postal_code: '100001',
          state: 'LA',
        },
      });
      expect(result.data).not.toHaveProperty('fulfillment_details');
      expect(result.data).not.toHaveProperty('selected_fulfillment_options');
    }
  });

  it('uses the first native ACP selected fulfillment option when multiple are supplied', () => {
    const result = agenticCheckoutUpdateSchema.safeParse({
      selected_fulfillment_options: [
        {
          type: 'pickup',
          option_id: 'pickup_store_1',
          item_ids: ['line_product-1'],
        },
        {
          type: 'shipping',
          option_id: 'shipping_standard',
          item_ids: ['line_product-1'],
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fulfillment_option_id).toBe('pickup_store_1');
    }
  });

  it('keeps update items when items and line_items are both provided', () => {
    const result = agenticCheckoutUpdateSchema.safeParse({
      items: [{ id: 'product-1', quantity: 1 }],
      line_items: [{ id: 'product-2', quantity: 2 }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([{ id: 'product-1', quantity: 1 }]);
    }
  });

  it.each([
    { line_items: [] },
    { line_items: [{ quantity: 1 }] },
    { line_items: [{ id: 'product-1', quantity: '2' }] },
  ])('rejects invalid update line_items payloads %#', (payload) => {
    const result = agenticCheckoutUpdateSchema.safeParse(payload);

    expect(result.success).toBe(false);
  });

  it('rejects empty update payloads', () => {
    const result = agenticCheckoutUpdateSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only fulfillment option identifiers', () => {
    const result = agenticCheckoutUpdateSchema.safeParse({
      fulfillment_option_id: '   ',
    });

    expect(result.success).toBe(false);
  });
});

describe('agentic checkout session lifecycle input schemas', () => {
  it('accepts checkout session reads with a session id', () => {
    const result = getAgenticCheckoutSessionInputSchema.safeParse({
      session_id: 'agentic_session_1',
    });

    expect(result.success).toBe(true);
  });

  it.each([
    {},
    { session_id: '' },
    { session_id: '   ' },
  ])('rejects invalid checkout session read input %#', (payload) => {
    const result = getAgenticCheckoutSessionInputSchema.safeParse(payload);

    expect(result.success).toBe(false);
  });

  it.each([
    { items: [{ id: 'product-1', quantity: 1 }] },
    { shipping_address: { address: '12 Example Street', city: 'Lagos' } },
    { fulfillment_option_id: 'shipping_standard' },
  ])('accepts single-field checkout session updates %#', (payload) => {
    const result = updateAgenticCheckoutSessionInputSchema.safeParse({
      idempotency_key: 'idem-update-1',
      session_id: 'agentic_session_1',
      ...payload,
    });

    expect(result.success).toBe(true);
  });

  it('normalizes ACP aliases for checkout session updates', () => {
    const result = updateAgenticCheckoutSessionInputSchema.safeParse({
      fulfillment_details: {
        address: {
          city: 'Lagos',
          line_one: '12 Example Street',
        },
      },
      line_items: [{ id: 'product-1', quantity: 2 }],
      selected_fulfillment_options: [
        {
          item_ids: ['line_product-1'],
          option_id: 'shipping_standard',
          type: 'shipping',
        },
      ],
      session_id: 'agentic_session_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        fulfillment_option_id: 'shipping_standard',
        items: [{ id: 'product-1', quantity: 2 }],
        shipping_address: {
          address: '12 Example Street',
          city: 'Lagos',
        },
      });
    }
  });

  it('rejects checkout session updates without update fields', () => {
    const result = updateAgenticCheckoutSessionInputSchema.safeParse({
      idempotency_key: 'idem-update-1',
      session_id: 'agentic_session_1',
    });

    expect(result.success).toBe(false);
  });

  it.each([
    { fulfillment_option_id: 'shipping_standard' },
    { fulfillment_option_id: 'shipping_standard', session_id: '' },
    { fulfillment_option_id: 'shipping_standard', session_id: '   ' },
    {
      fulfillment_option_id: 'shipping_standard',
      idempotency_key: 'short',
      session_id: 'agentic_session_1',
    },
    {
      fulfillment_option_id: 'shipping_standard',
      idempotency_key: 'x'.repeat(129),
      session_id: 'agentic_session_1',
    },
  ])('rejects invalid checkout session update input %#', (payload) => {
    const result = updateAgenticCheckoutSessionInputSchema.safeParse(payload);

    expect(result.success).toBe(false);
  });

  it.each([
    { session_id: 'agentic_session_1' },
    {
      idempotency_key: 'idem-cancel-1',
      session_id: 'agentic_session_1',
    },
  ])('accepts checkout session cancel input %#', (payload) => {
    const result = cancelAgenticCheckoutSessionInputSchema.safeParse({
      ...payload,
    });

    expect(result.success).toBe(true);
  });

  it.each([
    {},
    { session_id: '' },
    { session_id: '   ' },
    { idempotency_key: 'short', session_id: 'agentic_session_1' },
    { idempotency_key: 'x'.repeat(129), session_id: 'agentic_session_1' },
  ])('rejects invalid checkout session cancel input %#', (payload) => {
    const result = cancelAgenticCheckoutSessionInputSchema.safeParse(payload);

    expect(result.success).toBe(false);
  });
});

describe('agenticCheckoutCompleteSchema', () => {
  it('accepts buyer identity and a human-confirmed payment token', () => {
    const result = agenticCheckoutCompleteSchema.safeParse({
      buyer: {
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone_number: '+2348012345678',
      },
      completion_authorization: {
        amount: 500000,
        confirmed_at: '2026-04-28T11:59:30.000Z',
        currency: 'ngn',
        session_id: 'agentic_session_1',
        signature: 'a'.repeat(64),
        type: 'human_confirmation',
      },
      payment_data: { provider: 'paystack', token: 'confirmed-by-human' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.completion_authorization?.currency).toBe('NGN');
    }
  });

  it('accepts missing completion authorization so the route can return a consent challenge', () => {
    const result = agenticCheckoutCompleteSchema.safeParse({
      buyer: {
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone_number: '+2348012345678',
      },
      payment_data: { provider: 'paystack', token: 'confirmed-by-human' },
    });

    expect(result.success).toBe(true);
  });

  it('accepts pay on delivery without a payment token', () => {
    const result = agenticCheckoutCompleteSchema.safeParse({
      buyer: {
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone_number: '+2348012345678',
      },
      completion_authorization: {
        amount: 500000,
        confirmed_at: '2026-04-28T11:59:30.000Z',
        currency: 'ngn',
        session_id: 'agentic_session_1',
        signature: 'a'.repeat(64),
        type: 'human_confirmation',
      },
      payment_data: { provider: 'pay_on_delivery' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payment_data.provider).toBe('pay_on_delivery');
    }
  });

  it('rejects pay on delivery with an unexpected payment token', () => {
    const result = agenticCheckoutCompleteSchema.safeParse({
      buyer: {
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone_number: '+2348012345678',
      },
      completion_authorization: {
        amount: 500000,
        confirmed_at: '2026-04-28T11:59:30.000Z',
        currency: 'ngn',
        session_id: 'agentic_session_1',
        signature: 'a'.repeat(64),
        type: 'human_confirmation',
      },
      payment_data: {
        provider: 'pay_on_delivery',
        token: 'unexpected-token',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects Paystack payment data with unexpected fields', () => {
    const result = agenticCheckoutCompleteSchema.safeParse({
      buyer: {
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone_number: '+2348012345678',
      },
      payment_data: {
        provider: 'paystack',
        token: 'confirmed-by-human',
        unexpected: true,
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects completion without a non-empty payment token', () => {
    const result = agenticCheckoutCompleteSchema.safeParse({
      buyer: {
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone_number: '+2348012345678',
      },
      payment_data: { provider: 'paystack', token: '   ' },
    });

    expect(result.success).toBe(false);
  });

  it('rejects unsupported payment providers', () => {
    const result = agenticCheckoutCompleteSchema.safeParse({
      buyer: {
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone_number: '+2348012345678',
      },
      payment_data: { provider: 'stripe', token: 'confirmed-by-human' },
    });

    expect(result.success).toBe(false);
  });

  it('accepts paystack_bank_transfer as a Paystack provider alias', () => {
    const result = agenticCheckoutCompleteSchema.safeParse({
      buyer: {
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone_number: '+2348012345678',
      },
      payment_data: {
        provider: 'paystack_bank_transfer',
        token: 'manifest-advertised-token',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payment_data.provider).toBe('paystack');
      if (result.data.payment_data.provider === 'paystack') {
        expect(result.data.payment_data.token).toBe(
          'manifest-advertised-token'
        );
      }
    }
  });

  it('still accepts paystack as the canonical provider name', () => {
    const result = agenticCheckoutCompleteSchema.safeParse({
      buyer: {
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone_number: '+2348012345678',
      },
      payment_data: {
        provider: 'paystack',
        token: 'canonical-provider-token',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payment_data.provider).toBe('paystack');
    }
  });

  it('still rejects unexpected providers', () => {
    const result = agenticCheckoutCompleteSchema.safeParse({
      buyer: {
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone_number: '+2348012345678',
      },
      payment_data: {
        provider: 'paystack_card',
        token: 'invalid-provider-token',
      },
    });

    expect(result.success).toBe(false);
  });
});
