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
      { product_id: 'product', quantity: 1 },
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
