import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isStagingEnabled: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@/config/oxygen-storefront-staging', () => ({
  isOxygenStorefrontStagingEnabled: mocks.isStagingEnabled,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: mocks.getUser } }),
}));

import {
  postChatwootOxygenHandoff,
  verifyChatwootOxygenCheckoutSession,
} from './chatwoot-checkout-oxygen';

describe('chatwoot-checkout-oxygen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isStagingEnabled.mockReturnValue(true);
  });

  it('verifies staging flag and case-insensitive customer email match', async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { email: 'Ada@Example.com' } },
      error: null,
    });
    await expect(
      verifyChatwootOxygenCheckoutSession('  ada@example.com ')
    ).resolves.toBe(true);

    mocks.isStagingEnabled.mockReturnValueOnce(false);
    await expect(
      verifyChatwootOxygenCheckoutSession('ada@example.com')
    ).resolves.toBe(false);
  });

  it('posts secure_handoff only for valid UUID order IDs', () => {
    const postResult = vi.fn();
    const fail = vi.fn();

    postChatwootOxygenHandoff({
      orderId: 'not-a-uuid',
      requestId: 'req-1',
      canPost: () => true,
      postResult,
      fail,
    });
    expect(fail).toHaveBeenCalledWith('order_failed');
    expect(postResult).not.toHaveBeenCalled();

    const validOrderId = '550e8400-e29b-41d4-a716-446655440000';
    postChatwootOxygenHandoff({
      orderId: validOrderId,
      requestId: 'req-2',
      canPost: () => true,
      postResult,
      fail,
    });
    expect(postResult).toHaveBeenCalledWith({
      requestId: 'req-2',
      status: 'secure_handoff',
      href: `/payments/oxygen/${validOrderId}`,
    });
  });
});
