import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { isUcpSharedCartEnabled } from './is-ucp-shared-cart-enabled';
import { resolveUcpCartContext } from './ucp-cart-route-support';

vi.mock('./is-ucp-shared-cart-enabled', () => ({
  isUcpSharedCartEnabled: vi.fn(),
}));

vi.mock('@/lib/agentic/agent-request-controls', () => ({
  verifyAgenticRequestAccess: vi.fn(() => ({ ok: true })),
}));

vi.mock('@/lib/agentic/merchant-context', () => ({
  resolveAgenticMerchantContextFromRpc: vi.fn(async () => ({
    agent_user_agent_allowlist: [],
    agent_user_agent_denylist: [],
    agentic_checkout_enabled: true,
    business_name: 'Ogabassey',
    id: 'merchant-1',
    pay_on_delivery_enabled: false,
    paystack_subaccount_code: null,
    slug: 'ogabassey',
  })),
}));

vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: vi.fn(() => ({})),
}));

const request = () =>
  new NextRequest('http://localhost/api/agentic/carts/cart_123');

describe('resolveUcpCartContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the scoped context for a shared-cart merchant', async () => {
    vi.mocked(isUcpSharedCartEnabled).mockResolvedValue(true);

    const context = await resolveUcpCartContext(request());

    expect(context.ok).toBe(true);
    expect(createAgenticScopedSupabaseClient).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
  });

  it('fails closed before creating a scoped client when the merchant is not enrolled', async () => {
    vi.mocked(isUcpSharedCartEnabled).mockResolvedValue(false);

    const context = await resolveUcpCartContext(request());

    expect(context.ok).toBe(false);
    if (context.ok) return;
    expect(context.response.status).toBe(404);
    expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
  });
});
