import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fallbackAccess = vi.fn();
const merchantContext = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  getUserAccess: (...args: unknown[]) => fallbackAccess(...args),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) => merchantContext(...args),
  toUserAccess: (context: { merchantId: string }) => ({
    merchantId: context.merchantId,
    permissions: {},
  }),
}));

import { resolveAdsMerchantAccess } from './merchant-context';

describe('resolveAdsMerchantAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('binds an authorized selected merchant header instead of an unordered fallback merchant', async () => {
    const supabase = {};
    fallbackAccess.mockResolvedValue({ merchantId: 'fallback-merchant' });
    merchantContext.mockResolvedValue({ merchantId: 'selected-merchant' });

    const result = await resolveAdsMerchantAccess({
      request: new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/accounts',
        {
          headers: {
            'x-baci-merchant-id': '550e8400-e29b-41d4-a716-446655440000',
          },
        }
      ),
      supabase: supabase as never,
      userId: 'user',
    });

    expect(result.access?.merchantId).toBe('selected-merchant');
    expect(fallbackAccess).not.toHaveBeenCalled();
    expect(merchantContext).toHaveBeenCalledWith(supabase, 'user', {
      requestedMerchantId: '550e8400-e29b-41d4-a716-446655440000',
    });
  });

  it('rejects an invalid selected merchant before it falls back or queries access', async () => {
    const result = await resolveAdsMerchantAccess({
      request: new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/accounts',
        {
          headers: { 'x-baci-merchant-id': 'not-a-merchant-id' },
        }
      ),
      supabase: {} as never,
      userId: 'user',
    });

    expect(result.response?.status).toBe(400);
    expect(fallbackAccess).not.toHaveBeenCalled();
    expect(merchantContext).not.toHaveBeenCalled();
  });

  it('uses the validated OAuth navigation merchant query when explicitly requested', async () => {
    merchantContext.mockResolvedValue({ merchantId: 'oauth-merchant' });

    const result = await resolveAdsMerchantAccess({
      request: new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/connect?merchantId=550e8400-e29b-41d4-a716-446655440000'
      ),
      source: 'query',
      supabase: {} as never,
      userId: 'user',
    });

    expect(result.access?.merchantId).toBe('oauth-merchant');
  });

  it('rejects an invalid OAuth navigation merchant query before resolving access', async () => {
    const result = await resolveAdsMerchantAccess({
      request: new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/connect?merchantId=invalid'
      ),
      source: 'query',
      supabase: {} as never,
      userId: 'user',
    });

    expect(result.response?.status).toBe(400);
    expect(fallbackAccess).not.toHaveBeenCalled();
    expect(merchantContext).not.toHaveBeenCalled();
  });

  it('validates the signed OAuth merchant before resolving callback access', async () => {
    merchantContext.mockResolvedValue({ merchantId: 'callback-merchant' });

    const result = await resolveAdsMerchantAccess({
      merchantId: '550e8400-e29b-41d4-a716-446655440000',
      request: new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/callback'
      ),
      supabase: {} as never,
      userId: 'user',
    });

    expect(result.access?.merchantId).toBe('callback-merchant');
  });
});
