import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { expect, it, vi } from 'vitest';
import { readUcpCart } from './ucp-cart-read-route';

const input = {
  request: new NextRequest('https://example.invalid/api/agentic/carts/cart-a'),
  cartId: 'cart-a',
  agentId: 'agent-a',
  merchant: {
    id: 'merchant-a',
    slug: 'shop-a',
    business_name: 'Shop',
    agent_user_agent_allowlist: [],
    agent_user_agent_denylist: [],
    agentic_checkout_enabled: true,
    pay_on_delivery_enabled: false,
    paystack_subaccount_code: null,
  },
  supabase: createClient('https://example.invalid', 'fixture-key'),
};
it('returns the canonical cart scoped by the authenticated route', async () => {
  const deps = {
    canonical: vi
      .fn()
      .mockResolvedValue({ status: 200, body: { id: 'cart-a' } }),
    load: vi.fn().mockResolvedValue({ cart: null, error: null }),
    respond: vi.fn(),
  };
  const response = await readUcpCart(input, deps);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: 'cart-a' });
  expect(deps.canonical).toHaveBeenCalledWith({
    merchant: input.merchant,
    cartId: 'cart-a',
    agentId: 'agent-a',
    action: 'read',
  });
});

it('replays stored lane identity when the canonical cart lost it at create', async () => {
  const cart = {
    agent_id: 'agent-a',
    status: 'active',
    metadata: { source: 'ucp', create_recovery_pending: true },
    cart_items: [{ id: 'prod-1', quantity: 1, variant_id: 'variant-1' }],
  };
  const canonical = vi
    .fn()
    .mockResolvedValueOnce({
      status: 200,
      body: {
        id: 'cart-a',
        line_items: [{ item: { id: 'prod-1', quantity: 1 } }],
      },
    })
    .mockResolvedValueOnce({
      status: 200,
      body: {
        id: 'cart-a',
        line_items: [
          { item: { id: 'prod-1', variant_id: 'variant-1', quantity: 1 } },
        ],
      },
    })
    .mockResolvedValueOnce({
      status: 200,
      body: {
        id: 'cart-a',
        line_items: [
          { item: { id: 'prod-1', variant_id: 'variant-1', quantity: 1 } },
        ],
      },
    });
  const deps = {
    canonical,
    load: vi.fn().mockResolvedValue({ cart, error: null }),
    respond: vi.fn(),
  };
  const supabase = {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(async () => ({
              data: [{ cart_id: 'cart-a' }],
              error: null,
            })),
          })),
        })),
      })),
    })),
  };
  const response = await readUcpCart(
    { ...input, supabase: supabase as never },
    deps
  );
  expect(response.status).toBe(200);
  expect(canonical).toHaveBeenCalledTimes(3);
  expect(canonical.mock.calls[1][0]).toMatchObject({
    action: 'update',
    lines: [
      { item: { productId: 'prod-1', variantId: 'variant-1' }, quantity: 1 },
    ],
  });
  expect(canonical.mock.calls[2][0]).toMatchObject({ action: 'read' });
});
it('hides a missing legacy cart after a canonical bypass', async () => {
  const deps = {
    canonical: vi.fn().mockResolvedValue(null),
    load: vi.fn().mockResolvedValue({ cart: null, error: null }),
    respond: vi.fn(),
  };
  const response = await readUcpCart(input, deps);
  expect(response.status).toBe(404);
  expect(deps.load).toHaveBeenCalledWith({
    cartId: 'cart-a',
    merchantId: 'merchant-a',
    supabase: input.supabase,
  });
  expect(deps.respond).not.toHaveBeenCalled();
});
it('returns the scoped legacy projection for the verified caller', async () => {
  const cart = { agent_id: 'agent-a', status: 'active' };
  const deps = {
    canonical: vi.fn().mockResolvedValue(null),
    load: vi.fn().mockResolvedValue({ cart, error: null }),
    respond: vi.fn().mockResolvedValue(NextResponse.json({ id: 'cart-a' })),
  };
  const response = await readUcpCart(input, deps);
  expect(await response.json()).toEqual({ id: 'cart-a' });
  expect(deps.respond).toHaveBeenCalledWith({
    cart,
    merchant: input.merchant,
    request: input.request,
    supabase: input.supabase,
  });
});
it('returns a safe error when the scoped cart read fails', async () => {
  const deps = {
    canonical: vi.fn().mockResolvedValue(null),
    load: vi
      .fn()
      .mockResolvedValue({ cart: null, error: { message: 'fixture failure' } }),
    respond: vi.fn(),
  };
  const response = await readUcpCart(input, deps);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Database error' });
  expect(deps.respond).not.toHaveBeenCalled();
});
it('hides a legacy cart owned by a different agent', async () => {
  const deps = {
    canonical: vi.fn().mockResolvedValue(null),
    load: vi.fn().mockResolvedValue({
      cart: { agent_id: 'agent-b', status: 'active' },
      error: null,
    }),
    respond: vi.fn(),
  };
  const response = await readUcpCart(input, deps);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Cart not found' });
  expect(deps.respond).not.toHaveBeenCalled();
});

it.each([
  null,
  undefined,
])('hides legacy carts without an owner (%s)', async (agent_id) => {
  const deps = {
    canonical: vi.fn().mockResolvedValue(null),
    load: vi
      .fn()
      .mockResolvedValue({ cart: { agent_id, status: 'active' }, error: null }),
    respond: vi.fn(),
  };
  const response = await readUcpCart(input, deps);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Cart not found' });
  expect(deps.respond).not.toHaveBeenCalled();
});

it('does not replay stored lanes after the create-recovery marker clears', async () => {
  const cart = {
    agent_id: 'agent-a',
    status: 'active',
    metadata: { source: 'ucp', create_recovery_pending: false },
    cart_items: [{ id: 'prod-1', quantity: 1, variant_id: 'variant-1' }],
  };
  const canonical = vi.fn().mockResolvedValue({
    status: 200,
    body: {
      id: 'cart-a',
      line_items: [
        { item: { id: 'prod-1', variant_id: 'variant-2', quantity: 1 } },
      ],
    },
  });
  const deps = {
    canonical,
    load: vi.fn().mockResolvedValue({ cart, error: null }),
    respond: vi.fn(),
  };
  const response = await readUcpCart(input, deps);
  expect(response.status).toBe(200);
  expect(canonical).toHaveBeenCalledTimes(1);
});

it('recovers an option-only lane the canonical cart configured differently', async () => {
  const cart = {
    agent_id: 'agent-a',
    status: 'active',
    metadata: { source: 'ucp', create_recovery_pending: true },
    cart_items: [
      {
        id: 'prod-1',
        quantity: 1,
        variant_attributes: { color: 'red' },
      },
    ],
  };
  const canonical = vi
    .fn()
    .mockResolvedValueOnce({
      status: 200,
      body: {
        id: 'cart-a',
        line_items: [
          {
            item: {
              id: 'prod-1',
              quantity: 1,
              variant_attributes: { color: 'blue' },
            },
          },
        ],
      },
    })
    .mockResolvedValueOnce({ status: 200, body: { id: 'cart-a' } })
    .mockResolvedValueOnce({
      status: 200,
      body: { id: 'cart-a', marker: 'fresh-read' },
    });
  const supabase = {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(async () => ({
              data: [{ cart_id: 'cart-a' }],
              error: null,
            })),
          })),
        })),
      })),
    })),
  };
  const deps = {
    canonical,
    load: vi.fn().mockResolvedValue({ cart, error: null }),
    respond: vi.fn(),
  };
  const response = await readUcpCart(
    { ...input, supabase: supabase as never },
    deps
  );
  expect(response.status).toBe(200);
  // The answer comes from a fresh canonical read after the replay,
  // never from the replay's recorded state.
  expect(await response.json()).toMatchObject({ marker: 'fresh-read' });
  expect(canonical).toHaveBeenCalledTimes(3);
  expect(canonical.mock.calls[2][0]).toMatchObject({ action: 'read' });
  expect(canonical.mock.calls[1][0]).toMatchObject({
    action: 'update',
    lines: [
      {
        item: { productId: 'prod-1', options: { color: 'red' } },
        quantity: 1,
      },
    ],
  });
});

it('propagates a fresh-read failure instead of answering from the replay', async () => {
  const cart = {
    agent_id: 'agent-a',
    status: 'active',
    metadata: { source: 'ucp', create_recovery_pending: true },
    cart_items: [{ id: 'prod-1', quantity: 1, variant_id: 'variant-1' }],
  };
  const canonical = vi
    .fn()
    .mockResolvedValueOnce({
      status: 200,
      body: {
        id: 'cart-a',
        line_items: [{ item: { id: 'prod-1', quantity: 1 } }],
      },
    })
    .mockResolvedValueOnce({ status: 200, body: { id: 'cart-a' } })
    .mockResolvedValueOnce({
      status: 409,
      body: { code: 'version_conflict' },
    });
  const supabase = {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(async () => ({
              data: [{ cart_id: 'cart-a' }],
              error: null,
            })),
          })),
        })),
      })),
    })),
  };
  const deps = {
    canonical,
    load: vi.fn().mockResolvedValue({ cart, error: null }),
    respond: vi.fn(),
  };
  const response = await readUcpCart(
    { ...input, supabase: supabase as never },
    deps
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'version_conflict' });
});

it('fails closed when the recovery marker cannot be cleared', async () => {
  const cart = {
    agent_id: 'agent-a',
    status: 'active',
    metadata: { source: 'ucp', create_recovery_pending: true },
    cart_items: [{ id: 'prod-1', quantity: 1, variant_id: 'variant-1' }],
  };
  const canonical = vi
    .fn()
    .mockResolvedValueOnce({
      status: 200,
      body: {
        id: 'cart-a',
        line_items: [{ item: { id: 'prod-1', quantity: 1 } }],
      },
    })
    .mockResolvedValueOnce({ status: 200, body: { id: 'cart-a' } });
  const supabase = {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(async () => ({
              data: null,
              error: { message: 'db down' },
            })),
          })),
        })),
      })),
    })),
  };
  const deps = {
    canonical,
    load: vi.fn().mockResolvedValue({ cart, error: null }),
    respond: vi.fn(),
  };
  const response = await readUcpCart(
    { ...input, supabase: supabase as never },
    deps
  );
  expect(response.status).toBe(503);
});

it('scopes the recovery marker clear to the loaded row version', async () => {
  const cart = {
    agent_id: 'agent-a',
    status: 'active',
    updated_at: '2026-10-16T00:00:00.000Z',
    metadata: { source: 'ucp', create_recovery_pending: true },
    cart_items: [{ id: 'prod-1', quantity: 1, variant_id: 'variant-1' }],
  };
  const canonical = vi
    .fn()
    .mockResolvedValueOnce({
      status: 200,
      body: {
        id: 'cart-a',
        line_items: [{ item: { id: 'prod-1', quantity: 1 } }],
      },
    })
    .mockResolvedValueOnce({ status: 200, body: { id: 'cart-a' } })
    .mockResolvedValueOnce({ status: 200, body: { id: 'cart-a' } });
  const eqCalls: unknown[][] = [];
  const recordEq =
    (next: unknown) =>
    (...args: unknown[]) => {
      eqCalls.push(args);
      return next;
    };
  const select = vi.fn(async () => ({
    data: [{ cart_id: 'cart-a' }],
    error: null,
  }));
  const supabase = {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: recordEq({
          eq: recordEq({ eq: recordEq({ select }), select }),
        }),
      })),
    })),
  };
  const deps = {
    canonical,
    load: vi.fn().mockResolvedValue({ cart, error: null }),
    respond: vi.fn(),
  };
  const response = await readUcpCart(
    { ...input, supabase: supabase as never },
    deps
  );
  expect(response.status).toBe(200);
  expect(eqCalls).toContainEqual(['updated_at', '2026-10-16T00:00:00.000Z']);
  expect(select).toHaveBeenCalledWith('cart_id');
});
