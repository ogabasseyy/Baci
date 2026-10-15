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
    load: vi.fn(),
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
  expect(deps.load).not.toHaveBeenCalled();
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
