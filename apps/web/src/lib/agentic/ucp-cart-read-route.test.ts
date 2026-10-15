import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { verifyAgenticApiKey } from './auth';
import { readAgenticQueryRequest } from './mutation-request';
import { handleCanonicalUcpCart } from './ucp-canonical-cart';
import { GET } from './ucp-cart-read-route';
import {
  loadUcpCartSession,
  resolveUcpCartContext,
} from './ucp-cart-route-support';

vi.mock('./auth', () => ({ verifyAgenticApiKey: vi.fn() }));
vi.mock('./mutation-request', () => ({ readAgenticQueryRequest: vi.fn() }));
vi.mock('./ucp-canonical-cart', () => ({ handleCanonicalUcpCart: vi.fn() }));
vi.mock('./ucp-cart-route-support', () => ({
  resolveUcpCartContext: vi.fn(),
  loadUcpCartSession: vi.fn(),
  buildUcpCartStateResponse: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
it('rejects unauthenticated reads before querying a merchant or cart', async () => {
  vi.mocked(verifyAgenticApiKey).mockReturnValue(false);
  const response = await GET(
    new NextRequest('https://example.invalid/api/agentic/carts/cart'),
    { params: Promise.resolve({ id: 'cart' }) }
  );
  expect(response.status).toBe(401);
  expect(readAgenticQueryRequest).not.toHaveBeenCalled();
});
it('rejects malformed cart identity before querying cart data', async () => {
  vi.mocked(verifyAgenticApiKey).mockReturnValue(true);
  const response = await GET(
    new NextRequest('https://example.invalid/api/agentic/carts/cart'),
    { params: Promise.resolve({ id: '' }) }
  );
  expect(response.status).toBe(400);
  expect(readAgenticQueryRequest).not.toHaveBeenCalled();
});

it('returns the authenticated canonical cart for the resolved merchant and caller', async () => {
  vi.mocked(verifyAgenticApiKey).mockReturnValue(true);
  vi.mocked(readAgenticQueryRequest).mockResolvedValue({
    ok: true,
    agentId: 'agent-a',
    apiVersion: '2026-04-30',
    body: {},
    idempotencyKey: '',
    method: 'GET',
    pathname: '/api/agentic/carts/cart-a',
    rawBody: '',
    requestId: 'request-a',
  });
  const merchant = {
    id: 'merchant-a',
    slug: 'shop-a',
    business_name: 'Shop',
    agent_user_agent_allowlist: [],
    agent_user_agent_denylist: [],
    agentic_checkout_enabled: true,
    pay_on_delivery_enabled: false,
    paystack_subaccount_code: null,
  };
  vi.mocked(resolveUcpCartContext).mockResolvedValue({
    ok: true,
    merchant,
    supabase: createClient('https://example.invalid', 'fixture-key'),
  });
  vi.mocked(handleCanonicalUcpCart).mockResolvedValue({
    status: 200,
    body: { id: 'cart-a', status: 'active' },
  });
  const response = await GET(
    new NextRequest('https://example.invalid/api/agentic/carts/cart-a'),
    { params: Promise.resolve({ id: 'cart-a' }) }
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: 'cart-a', status: 'active' });
  expect(handleCanonicalUcpCart).toHaveBeenCalledWith({
    merchant,
    cartId: 'cart-a',
    agentId: 'agent-a',
    action: 'read',
  });
  expect(loadUcpCartSession).not.toHaveBeenCalled();
});
