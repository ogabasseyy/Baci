import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { baseConfig } from './zoho-blog-campaign-dispatch.test-utils';
import { syncZohoNewsletterSubscriber } from './zoho-newsletter-subscription';

const merchantZohoSettings = {
  zohoCampaigns: {
    enabled: true,
    fromEmail: 'news@merchant.test',
    listKey: 'merchant-list-key',
  },
};

function createSupabaseMock(customSettings: unknown = merchantZohoSettings) {
  return {
    // The refresh token is stored apart from custom_settings (read via RPC).
    rpc: () => ({ data: 'merchant-refresh-token', error: null }),
    from(table: string) {
      const maybeSingle = () =>
        table === 'merchant_feature_settings'
          ? { data: { custom_settings: customSettings }, error: null }
          : {
              data: {
                brand_colors: { primary: '#dc2626' },
                business_name: 'Oga Gadgets',
              },
              error: null,
            };
      return { select: () => ({ eq: () => ({ maybeSingle }) }) };
    },
  } as unknown as SupabaseClient;
}

describe('syncZohoNewsletterSubscriber', () => {
  it('subscribes the email to the merchant Zoho list', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'access-token' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: '200', status: 'success' }), {
          status: 200,
        })
      );

    const result = await syncZohoNewsletterSubscriber({
      config: baseConfig,
      email: 'Customer@Example.com',
      fetchImpl,
      merchantId: 'merchant-1',
      source: 'footer',
      supabase: createSupabaseMock(),
    });

    expect(result.status).toBe('synced');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      'https://campaigns.zoho.com/api/v1.1/listsubscribe'
    );

    const body = fetchImpl.mock.calls[1]?.[1]?.body as URLSearchParams;
    expect(body.get('listkey')).toBe('merchant-list-key');
    expect(body.get('contactinfo')).toBe(
      JSON.stringify({
        ContactEmail: 'customer@example.com',
        Source: 'footer',
      })
    );
  });

  it('skips when Zoho Campaigns is not configured for the merchant', async () => {
    const fetchImpl = vi.fn();

    const result = await syncZohoNewsletterSubscriber({
      config: baseConfig,
      email: 'customer@example.com',
      fetchImpl,
      merchantId: 'merchant-1',
      source: 'widget',
      supabase: createSupabaseMock({ zohoCampaigns: { enabled: false } }),
    });

    expect(result).toEqual({
      reason: 'Zoho Campaigns is not enabled for this merchant',
      status: 'skipped',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
