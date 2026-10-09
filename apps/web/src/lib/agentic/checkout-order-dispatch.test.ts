import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAgenticCheckoutOrder,
  sendAgenticOrderCreatedWebhook,
} from '@/lib/agentic/checkout-order-dispatch';
import { sendAgenticWebhook } from '@/lib/agentic/webhooks';
import { logger } from '@/lib/logger';

vi.mock('@/lib/agentic/webhooks', () => ({
  sendAgenticWebhook: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

const merchantId = '11111111-1111-4111-8111-111111111111';

// B3.5 round 7 (CodeRabbit High): the dispatch passes the
// caller-supplied scoped client straight through to the tax
// helper — no service-role escalation in the Next.js layer. The
// supabase mock needs to handle:
//   * `merchants.select(...).eq(...).maybeSingle()` (helper)
//   * `products.select(...).eq(...).in(...).returns()` (helper)
//   * `rpc('get_order_variant_overrides', ...)` (helper)
//   * `rpc('create_storefront_order', ...)` (dispatch's order create)
//
// `makeFromStub` returns a per-table `from` that defaults to
// "merchant not registered" and "no products", so the helper
// short-circuits to tax 0 and existing dispatch assertions are
// unchanged.
function makeFromStub(opts?: { vatStatus?: 'registered' | 'not_registered' }) {
  const vatStatus = opts?.vatStatus ?? 'not_registered';
  return (table: string) => {
    if (table === 'merchants') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { vat_registration_status: vatStatus },
                error: null,
              }),
          }),
        }),
      };
    }
    if (table === 'products') {
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              returns: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in dispatch test: ${table}`);
  };
}

function orderPayload() {
  return {
    customer_email: 'buyer@example.com',
    customer_name: 'Ada Lovelace',
    customer_phone: '+2348012345678',
    items: [
      {
        name: 'Phone',
        price: 500_000,
        product_id: 'product-1',
        quantity: 1,
      },
    ],
    merchant_id: merchantId,
    payment_method: 'bank_transfer',
    payment_status: 'pending',
    shipping_fee: 0,
    shipping_status: 'pending',
    source: 'agentic_ai',
    subtotal: 500_000,
    tax_amount: 0,
  };
}

describe('agentic checkout order dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an order through the order RPC and returns the order id', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'order-1', total: 500_000 }],
      error: null,
    });

    const result = await createAgenticCheckoutOrder(orderPayload(), {
      rpc,
      from: makeFromStub(),
    } as unknown as SupabaseClient);

    expect(result).toMatchObject({
      ok: true,
      orderId: 'order-1',
      status: 201,
    });
    expect(rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({
        p_customer_email: 'buyer@example.com',
        p_items: [
          expect.objectContaining({
            product_id: 'product-1',
            quantity: 1,
          }),
        ],
        p_merchant_id: merchantId,
        p_payment_method: 'bank_transfer',
        p_user_id: null,
      })
    );
  });

  it('forwards computed VAT as p_tax_amount for VAT-registered merchants (Codex P1 round 5)', async () => {
    // The agentic `calculateCheckoutSession` always emits `tax: 0`,
    // so `body.tax_amount` arrives at the RPC as 0. Without this
    // recompute, a VAT-registered merchant gets `tax_amount_mismatch`
    // → 400 → broken checkout. Round 7: the helper now reads
    // through the caller's scoped client (no admin client), so the
    // VAT fixture is wired on the `supabase` passed to
    // `createAgenticCheckoutOrder`.
    const from = (table: string) => {
      if (table === 'merchants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { vat_registration_status: 'registered' },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === 'products') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                returns: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: 'product-1',
                        price: 500_000,
                        vat_category_code: 'S',
                        vat_rate: 7.5,
                      },
                    ],
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      throw new Error('unexpected');
    };

    const rpc = vi.fn((name: string, _args?: unknown) => {
      if (name === 'get_order_variant_overrides') {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === 'create_storefront_order') {
        return Promise.resolve({
          data: [{ id: 'order-vat-1', total: 537_500 }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const result = await createAgenticCheckoutOrder(orderPayload(), {
      from,
      rpc,
    } as unknown as SupabaseClient);

    expect(result.ok).toBe(true);
    // ROUND(ROUND(1 * 500000, 2) * 7.5 / 100, 2) = 37500
    expect(rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({
        p_tax_amount: 37_500,
      })
    );
  });

  it('returns 500 when the VAT recompute throws (Codex P2 round 5)', async () => {
    // Distinct from the RPC-level 400 path: an infra failure in
    // the per-line VAT lookup (DB/RLS error) must surface as 500
    // so the GPT-agent caller retries. Round 7: the helper reads
    // through the caller's scoped client, so we trigger the
    // failure on the `merchants` lookup of THAT client.
    const from = (table: string) => {
      if (table === 'merchants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: null,
                  error: { message: 'connection reset' },
                }),
            }),
          }),
        };
      }
      throw new Error('unexpected');
    };

    const rpc = vi.fn();
    const result = await createAgenticCheckoutOrder(orderPayload(), {
      from,
      rpc,
    } as unknown as SupabaseClient);

    expect(result).toMatchObject({
      error: 'Unable to compute order tax',
      ok: false,
      orderId: undefined,
      status: 500,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Agentic checkout VAT recompute failed',
      })
    );
  });

  it('forwards body.expected_total to p_expected_total when set (Codex P1 round 8)', async () => {
    // When the agentic caller supplies an expected_total (future
    // VAT-aware session calc), it must reach the RPC so the
    // `order_total_mismatch` parity guard fires. When absent, we
    // pass null (parity check skipped). Pin both branches.
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'order-et-1', total: 500_000 }],
      error: null,
    });

    const supabase = {
      from: makeFromStub(),
      rpc,
    } as unknown as SupabaseClient;

    await createAgenticCheckoutOrder(
      { ...orderPayload(), expected_total: 500_000 },
      supabase
    );
    expect(rpc).toHaveBeenLastCalledWith(
      'create_storefront_order',
      expect.objectContaining({ p_expected_total: 500_000 })
    );

    rpc.mockClear();
    await createAgenticCheckoutOrder(orderPayload(), supabase);
    expect(rpc).toHaveBeenLastCalledWith(
      'create_storefront_order',
      expect.objectContaining({ p_expected_total: null })
    );
  });

  it('forwards body.gift_wrapping_fee through to p_gift_wrapping_fee (Codex P1 round 7)', async () => {
    // Pre-fix the dispatch silently dropped `p_gift_wrapping_fee`
    // — the RPC used its default 0 and any agentic caller that
    // started passing the field would have under-quoted. Defense-
    // in-depth contract: the dispatch must forward whatever Zod
    // produced (defaulted to 0, but a non-zero value must reach
    // the RPC unchanged).
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'order-gw-1', total: 501_000 }],
      error: null,
    });

    const result = await createAgenticCheckoutOrder(
      { ...orderPayload(), gift_wrapping_fee: 1_000 },
      {
        from: makeFromStub(),
        rpc,
      } as unknown as SupabaseClient
    );

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({ p_gift_wrapping_fee: 1_000 })
    );
  });

  it('maps a 22P02 UUID parse error from the tax helper to 400 invalid_items (Codex P2 round 7)', async () => {
    // Pre-round-7 a malformed item id surfaced as a 500
    // (Unable to compute order tax) because we caught ALL helper
    // errors and reported infra failure. Round 7: helper reads
    // through the caller's scoped client; trigger 22P02 on the
    // products query of THAT client.
    const from = (table: string) => {
      if (table === 'merchants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { vat_registration_status: 'registered' },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === 'products') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                returns: () =>
                  Promise.resolve({
                    data: null,
                    error: {
                      code: '22P02',
                      message: 'invalid input syntax for type uuid: "bogus"',
                    },
                  }),
              }),
            }),
          }),
        };
      }
      throw new Error('unexpected');
    };

    const rpc = vi.fn();
    const result = await createAgenticCheckoutOrder(orderPayload(), {
      from,
      rpc,
    } as unknown as SupabaseClient);

    expect(result).toMatchObject({
      error: 'invalid_items',
      ok: false,
      orderId: undefined,
      status: 400,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the order RPC error without creating a false success', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'insufficient_stock', message: 'insufficient_stock' },
    });

    const result = await createAgenticCheckoutOrder(orderPayload(), {
      rpc,
      from: makeFromStub(),
    } as unknown as SupabaseClient);

    expect(result).toMatchObject({
      error: 'insufficient_stock',
      ok: false,
      orderId: undefined,
      status: 400,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'insufficient_stock',
        message: 'Agentic checkout order RPC failed',
      })
    );
  });

  it.each([
    'invalid_offer',
    'insufficient_offer_stock',
  ])('maps the order RPC %s rejection to a 400', async (code) => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code, message: code },
    });

    const result = await createAgenticCheckoutOrder(orderPayload(), {
      rpc,
      from: makeFromStub(),
    } as unknown as SupabaseClient);

    expect(result).toMatchObject({
      error: code,
      ok: false,
      orderId: undefined,
      status: 400,
    });
  });

  it('does not expose unknown order RPC error details to callers', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST000', message: 'database internals leaked' },
    });

    const result = await createAgenticCheckoutOrder(orderPayload(), {
      rpc,
      from: makeFromStub(),
    } as unknown as SupabaseClient);

    expect(result).toMatchObject({
      data: {
        details: 'Unable to create order',
        error: 'Failed to create order',
      },
      error: 'Unable to create order',
      ok: false,
      status: 500,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'PGRST000',
        message: 'Agentic checkout order RPC failed',
      })
    );
  });

  it('rejects an order response when the order total is not numeric', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'order-1', total: 'not-a-number' }],
      error: null,
    });

    const result = await createAgenticCheckoutOrder(orderPayload(), {
      rpc,
      from: makeFromStub(),
    } as unknown as SupabaseClient);

    expect(result).toMatchObject({
      data: { error: 'Invalid order total' },
      error: 'Invalid order total',
      ok: false,
      orderId: undefined,
      status: 422,
      statusText: 'Unprocessable Entity',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Agentic checkout order returned invalid total',
        orderId: 'order-1',
        total: 'not-a-number',
      })
    );
  });

  it('rounds quantity-aware assurance fees before sending order items to the RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'order-1', total: 500_000 }],
      error: null,
    });

    await createAgenticCheckoutOrder(
      {
        ...orderPayload(),
        items: [
          {
            has_assurance: true,
            name: 'Phone',
            price: 333.33,
            product_id: 'product-1',
            quantity: 2,
          },
        ],
      },
      { from: makeFromStub(), rpc } as unknown as SupabaseClient
    );

    expect(rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({
        p_items: [
          expect.objectContaining({
            assurance_fee: 33.33,
          }),
        ],
      })
    );
  });

  it('sends the agentic order-created webhook asynchronously', () => {
    sendAgenticOrderCreatedWebhook({
      buyer: {
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone_number: '+2348012345678',
      },
      currency: 'NGN',
      orderId: 'order-1',
      sessionId: 'agentic_session_1',
      total: 500000,
    });

    expect(sendAgenticWebhook).toHaveBeenCalledWith(
      'order.created',
      expect.objectContaining({
        id: 'order-1',
        currency: 'NGN',
        total: 500000,
        buyer: expect.objectContaining({
          email: 'buyer@example.com',
        }),
      })
    );
  });

  it('logs webhook delivery failures without throwing synchronously', async () => {
    const error = new Error('webhook offline');
    vi.mocked(sendAgenticWebhook).mockRejectedValue(error);

    expect(() =>
      sendAgenticOrderCreatedWebhook({
        buyer: {
          email: 'buyer@example.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
          phone_number: '+2348012345678',
        },
        currency: 'NGN',
        orderId: 'order-1',
        sessionId: 'agentic_session_1',
        total: 500000,
      })
    ).not.toThrow();
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: '{}',
        message: 'Webhook trigger failed',
        sessionId: 'agentic_session_1',
      })
    );
  });
});
