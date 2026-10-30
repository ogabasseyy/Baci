import { describe, expect, it, vi } from 'vitest';
import { createRedvaultCheckoutResponse } from './create-redvault-checkout-response';
import { redvaultTestQuote } from './redvault-test-fixture';

vi.mock('@/lib/quiz-proof', () => ({
  createQuizRpcServerProof: vi.fn((value) => value),
}));
const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const row = {
  status: 'pending',
  id: '44444444-4444-4444-8444-444444444444',
  quote_version_id: '55555555-5555-4555-8555-555555555555',
  quote_payload_hash: 'a'.repeat(64),
  proof_context: {
    applicationId: '22222222-2222-4222-8222-222222222222',
    taxBasis: 'exclusive',
    discountKobo: 1000,
    eligibleSubtotalKobo: 10000,
    productSubtotalKobo: 10000,
    groups: redvaultTestQuote.groups.map((group) => ({
      ...group,
      members: group.members.map((member) => ({
        ...member,
        orderItemId: '33333333-3333-4333-8333-333333333333',
      })),
    })),
  },
};
const summaryRow = {
  order_id: row.id,
  total: 112.5,
  currency: 'NGN',
  tracking_token: 'track-1',
  payment_method: 'uba_redvault',
  payment_status: 'unpaid',
  product_subtotal_kobo: 11000,
  eligible_subtotal_kobo: 10000,
  ineligible_subtotal_kobo: 1000,
  discount_kobo: 1000,
  assurance_fee_kobo: 0,
  tax_kobo: 750,
  shipping_kobo: 500,
  gift_wrapping_kobo: 0,
  payable_kobo: 11250,
  mixed_basket: true,
};
describe('REDVAULT checkout response', () => {
  const sharedCart = {
    binding: {
      cart_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      cart_version: 3,
      checkout_generation: 2,
      checkout_session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
    principalId: 'verified-principal',
  };
  const boundReceipt = {
    ok: true,
    replayed: false,
    order: { ...row, idempotency_replayed: false },
    binding: {
      cartId: sharedCart.binding.cart_id,
      cartVersionReviewed: sharedCart.binding.cart_version,
      checkout_generation: sharedCart.binding.checkout_generation,
      merchantId,
      sessionId: sharedCart.binding.checkout_session_id,
      variant: 'redvault',
    },
  };
  const boundInput = {
    orderRpcArgs: {
      p_merchant_id: merchantId,
      p_customer_email: ' Customer@Example.Test ',
      p_payment_method: 'uba_redvault',
      p_checkout_idempotency_key: 'checkout-key',
      p_items: [{ cart_line_id: 'line', product_id: 'product', quantity: 1 }],
    },
    quote: redvaultTestQuote,
    merchantId,
    customerEmail: ' Customer@Example.Test ',
    userId: null,
    sharedCart,
  };

  it.each([
    false,
    true,
  ])('creates or replays the reviewed shared-cart draft (replay: %s)', async (replayed) => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          ...boundReceipt,
          replayed,
          order: { ...row, idempotency_replayed: replayed },
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: [summaryRow], error: null });
    const response = await createRedvaultCheckoutResponse({
      ...boundInput,
      client: { rpc } as never,
    });
    expect(response.status).toBe(replayed ? 200 : 201);
    expect(response.headers.get('x-idempotency-replayed')).toBe(
      replayed ? 'true' : null
    );
    const [name, request] = rpc.mock.calls[0];
    expect(name).toBe('create_storefront_order_with_cart_binding');
    expect(request).toMatchObject({
      p_variant: 'redvault',
      p_session_id: sharedCart.binding.checkout_session_id,
      p_generation: 2,
      p_args: {
        ...boundInput.orderRpcArgs,
        p_cart_id: sharedCart.binding.cart_id,
        p_cart_version: 3,
        p_cart_principal_id: sharedCart.principalId,
        p_redvault_quote: redvaultTestQuote,
      },
    });
    expect(request.p_args.p_redvault_order).toMatchObject({
      customer_email: 'customer@example.test',
      items: [
        { cart_line_id: 'line', condition: 'new', variant_attributes: {} },
      ],
    });
    expect(request.p_args.p_redvault_route_proof.payload).toEqual({
      order: request.p_args.p_redvault_order,
      quote: redvaultTestQuote,
    });
    expect(rpc.mock.calls[1][0]).toBe(
      'get_storefront_redvault_checkout_summary'
    );
  });

  it.each([
    { binding: { ...boundReceipt.binding, variant: 'base' } },
    { binding: { ...boundReceipt.binding, cartId: 'wrong-cart' } },
    { binding: { ...boundReceipt.binding, sessionId: 'wrong-session' } },
    { binding: { ...boundReceipt.binding, merchantId: 'wrong-merchant' } },
    { binding: { ...boundReceipt.binding, cartVersionReviewed: 4 } },
    { replayed: true },
    { order: { ...row, quote_version_id: null, idempotency_replayed: false } },
  ])('rejects a malformed or mismatched shared-cart receipt', async (override) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...boundReceipt, ...override },
      error: null,
    });
    const response = await createRedvaultCheckoutResponse({
      ...boundInput,
      client: { rpc } as never,
    });
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe(
      'SHARED_CART_TEMPORARILY_UNAVAILABLE'
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['cart_checkout_stale', 409, 'SHARED_CART_STALE'],
    ['cart_checkout_expired', 409, 'SHARED_CART_SESSION_EXPIRED'],
    ['cart_order_unauthorized', 403, 'SHARED_CART_BINDING_FORBIDDEN'],
  ])('maps %s without leaking the database error', async (message, status, code) => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'P0001', message } });
    const response = await createRedvaultCheckoutResponse({
      ...boundInput,
      client: { rpc } as never,
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not submit a shared cart without a verified principal', async () => {
    const rpc = vi.fn();
    const response = await createRedvaultCheckoutResponse({
      ...boundInput,
      client: { rpc } as never,
      sharedCart: { ...sharedCart, principalId: null },
    });
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['checkout_idempotency_conflict', 'CHECKOUT_IDEMPOTENCY_CONFLICT'],
    ['order_not_reusable', 'CHECKOUT_ORDER_NOT_REUSABLE'],
  ])('maps a rejected REDVAULT replay safely: %s', async (message, code) => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'P0001', message } });
    const response = await createRedvaultCheckoutResponse({
      ...boundInput,
      client: { rpc } as never,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code });
  });
  it('does not forward the web pre-REDVAULT expected_total into discounted order creation', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'redvault_disabled' },
    });
    await createRedvaultCheckoutResponse({
      client: { rpc } as never,
      orderRpcArgs: {
        p_merchant_id: merchantId,
        p_customer_email: 'customer@example.test',
        p_expected_total: 107.5,
        p_items: [
          { product_id: 'product', quantity: 1, variant_id: undefined },
        ],
      },
      quote: redvaultTestQuote,
      merchantId,
      customerEmail: 'customer@example.test',
      userId: null,
    });
    expect(rpc.mock.calls[0][1].p_order.discount_amount).toBe(10);
    expect(rpc.mock.calls[0][1].p_order.expected_total).toBeNull();
    expect(rpc.mock.calls[0][1].p_route_proof.payload.order.items).toEqual([
      {
        condition: 'new',
        product_id: 'product',
        quantity: 1,
        variant_attributes: {},
      },
    ]);
    expect(
      Object.hasOwn(rpc.mock.calls[0][1].p_order.items[0], 'variant_id')
    ).toBe(false);
  });
  it('omits the pre-discount expected total and signs the authoritative order and quote', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [row], error: null })
      .mockResolvedValueOnce({ data: [summaryRow], error: null });
    const response = await createRedvaultCheckoutResponse({
      client: { rpc } as never,
      orderRpcArgs: {
        p_merchant_id: merchantId,
        p_customer_email: 'customer@example.test',
        p_expected_total: 122.5,
      },
      quote: redvaultTestQuote,
      merchantId,
      customerEmail: 'customer@example.test',
      userId: null,
    });
    expect(response.status).toBe(201);
    expect(rpc.mock.calls[0][1].p_order).toEqual({
      merchant_id: merchantId,
      customer_email: 'customer@example.test',
      discount_amount: 10,
      expected_total: null,
    });
    expect(rpc.mock.calls[0][1].p_route_proof).toEqual({
      action: 'storefront_redvault_order_create',
      subjectId: merchantId,
      userId: 'guest',
      payload: {
        order: rpc.mock.calls[0][1].p_order,
        quote: redvaultTestQuote,
      },
    });
    expect(await response.json()).toEqual({
      order: {
        id: row.id,
        total: 112.5,
        currency: 'NGN',
        tracking_token: 'track-1',
        payment_method: 'uba_redvault',
        payment_status: 'unpaid',
      },
      redvault: {
        status: 'pending',
        quote: {
          product_subtotal_kobo: 11000,
          eligible_subtotal_kobo: 10000,
          ineligible_subtotal_kobo: 1000,
          discount_kobo: 1000,
          assurance_fee_kobo: 0,
          tax_kobo: 750,
          shipping_kobo: 500,
          gift_wrapping_kobo: 0,
          payable_kobo: 11250,
          mixed_basket: true,
        },
      },
    });
  });
  it('marks an idempotency replayed draft like the ordinary order path', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ ...row, idempotency_replayed: true }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [summaryRow], error: null });
    const response = await createRedvaultCheckoutResponse({
      client: { rpc } as never,
      orderRpcArgs: {
        p_merchant_id: merchantId,
        p_customer_email: 'customer@example.test',
      },
      quote: redvaultTestQuote,
      merchantId,
      customerEmail: 'customer@example.test',
      userId: null,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-idempotency-replayed')).toBe('true');
    expect(await response.json()).toMatchObject({
      idempotency: { replayed: true },
      order: { id: row.id },
    });
  });
  it('never exposes an unattached draft as a usable order', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          ...row,
          status: 'draft',
        },
      ],
      error: null,
    });
    const response = await createRedvaultCheckoutResponse({
      client: { rpc } as never,
      orderRpcArgs: {},
      quote: redvaultTestQuote,
      merchantId,
      customerEmail: 'customer@example.test',
      userId: null,
    });
    expect(response.status).toBe(409);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('signs the selected variant condition rather than the client item condition', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'redvault_disabled' },
    });
    const quote = {
      ...redvaultTestQuote,
      lines: redvaultTestQuote.lines.map((line) => ({
        ...line,
        condition: 'used',
      })),
    };

    await createRedvaultCheckoutResponse({
      client: { rpc } as never,
      orderRpcArgs: {
        p_items: [{ condition: 'new', product_id: 'product', quantity: 1 }],
      },
      quote,
      merchantId,
      customerEmail: 'customer@example.test',
      userId: null,
    });

    expect(rpc.mock.calls[0][1].p_order.items).toEqual([
      {
        condition: 'used',
        product_id: 'product',
        quantity: 1,
        variant_attributes: {},
      },
    ]);
    expect(rpc.mock.calls[0][1].p_route_proof.payload.order.items).toEqual([
      {
        condition: 'used',
        product_id: 'product',
        quantity: 1,
        variant_attributes: {},
      },
    ]);
  });
  it('reports infrastructure failures without exposing their details', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'private database connection failure' },
    });
    const response = await createRedvaultCheckoutResponse({
      client: { rpc } as never,
      orderRpcArgs: {},
      quote: redvaultTestQuote,
      merchantId,
      customerEmail: 'customer@example.test',
      userId: null,
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: 'REDVAULT_ORDER_FAILED',
      error: 'Unable to create REDVAULT order',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('reports disabled without signing or attachment', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'redvault_disabled' },
    });
    const response = await createRedvaultCheckoutResponse({
      client: { rpc } as never,
      orderRpcArgs: {},
      quote: redvaultTestQuote,
      merchantId,
      customerEmail: 'customer@example.test',
      userId: null,
    });
    expect((await response.json()).code).toBe('REDVAULT_DISABLED');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
