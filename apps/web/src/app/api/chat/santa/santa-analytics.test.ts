import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAgenticScopedSupabaseClient: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: mocks.createAgenticScopedSupabaseClient,
}));

import { logSantaInteraction } from './santa-analytics';

const tenant = {
  agenticCheckoutEnabled: true,
  businessName: 'Ogabassey',
  currencyCode: 'NGN',
  merchantId: '3bc72679-c0f7-4db4-9054-6a4a4a95a498',
  merchantSlug: 'ogabassey',
  priceNegotiationEnabled: true,
};

describe('logSantaInteraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ insert: mocks.insert });
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: mocks.from,
    });
  });

  it('skips analytics when agentic checkout is disabled', async () => {
    await logSantaInteraction({
      clientIp: '1.2.3.4',
      response: 'Ho ho ho!',
      tenant: { ...tenant, agenticCheckoutEnabled: false },
      userMessage: 'Hello Santa',
    });

    expect(mocks.createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('records a wish_granted interaction with bounded fields', async () => {
    await logSantaInteraction({
      clientIp: '9'.repeat(100),
      response: 'Granted! ACTION:ADD_TO_CART|PRODUCT:Phone|PRICE:450000',
      tenant,
      userMessage: 'Please sell it for 500000',
    });

    expect(mocks.createAgenticScopedSupabaseClient).toHaveBeenCalledWith({
      merchantId: tenant.merchantId,
      merchantSlug: tenant.merchantSlug,
      sessionId: expect.any(String),
    });
    expect(mocks.from).toHaveBeenCalledWith('santa_interactions');
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        approved_price: 450000,
        client_ip: '9'.repeat(64),
        discount_percentage: 10,
        interaction_type: 'wish_granted',
        merchant_id: tenant.merchantId,
        product_name: 'Phone',
        requested_price: 500000,
      })
    );
    const inserted = mocks.insert.mock.calls.at(0)?.[0] as
      | { session_id?: unknown }
      | undefined;
    expect(inserted?.session_id).toEqual(expect.any(String));
    expect(inserted?.session_id as string).toHaveLength(32);
  });

  it('records a wish_denied interaction for budget rejections', async () => {
    await logSantaInteraction({
      clientIp: '1.2.3.4',
      response: 'Sorry, I cannot approve that price, our budget is below cost.',
      tenant,
      userMessage: undefined,
    });

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        approved_price: null,
        interaction_type: 'wish_denied',
        product_name: null,
        user_message: null,
      })
    );
  });

  it.each([
    'I cannot grant that wish; please save up a little more.',
    "Santa's workshop has costs, consider a payment plan.",
  ])('records a wish_denied interaction for refusal "%s"', async (response) => {
    await logSantaInteraction({
      clientIp: '1.2.3.4',
      response,
      tenant,
      userMessage: 'Please approve 1000',
    });

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ interaction_type: 'wish_denied' })
    );
  });

  it('throws when the scoped insert fails', async () => {
    mocks.insert.mockResolvedValue({ error: new Error('row violates policy') });

    await expect(
      logSantaInteraction({
        clientIp: '1.2.3.4',
        response: 'Ho ho ho!',
        tenant,
        userMessage: 'Hello Santa',
      })
    ).rejects.toThrow('Santa interaction could not be recorded');
  });
});
