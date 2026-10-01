import { beforeEach, describe, expect, it, vi } from 'vitest';

const { GET } = await import('./route');

import { routeTestHarness } from './route.test-setup';

const { createCronRequest, createSupabaseMock } = routeTestHarness;

const {
  getCronSecret,
  loadAgenticActionHealth,
  checkAgentCommerceFeedHealth,
  checkAgentCommerceUniversalCartReadiness,
  checkAgentCommerceManifestHealth,
  checkAgentCommercePublicProductParity,
  checkAgentCommerceSupportChatHealth,
  checkAgentCommerceTrustHealth,
  createAdminClient,
} = routeTestHarness.mocks;

describe('GET /api/cron/agentic-commerce-health', () => {
  beforeEach(() => {
    routeTestHarness.reset();
  });

  it('returns 500 when the cron secret is not configured', async () => {
    vi.mocked(getCronSecret).mockReturnValue(undefined);

    const response = await GET(createCronRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: 'server_misconfigured',
      error: 'Server misconfigured',
    });
  });

  it('returns a healthy monitor summary for the requested merchant slugs', async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(supabase as never);

    const response = await GET(
      createCronRequest({
        search: '?merchant_slug=Ogabassey&fail_on_attention=false',
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      merchant_count: 1,
      merchants: [
        {
          actions: [],
          action_health: {
            actions: {
              ok_count: 1,
              total_count: 1,
            },
            requests: {
              recent_count: 1,
            },
          },
          business_name: 'Ogabassey',
          crawler: {
            issue_count: 0,
            status: 'ok',
          },
          feeds: {
            google_product_count: 2,
            openai_product_count: 2,
            status: 'ok',
          },
          merchant_id: 'merchant-1',
          parity: {
            issue_count: 0,
            sample_product_id: 'product-1',
            status: 'ok',
          },
          slug: 'ogabassey',
          status: 'ok',
          status_reason: 'agentic_action_health_ok',
          trust: {
            issue_count: 0,
            status: 'ok',
            url: 'https://ogabassey.com/agent-trust.json',
          },
          universal_cart: {
            status: 'pass',
            url: 'https://ogabassey.com/.well-known/ucp',
          },
        },
      ],
      status: 'ok',
      support_chat: {
        issue_count: 0,
        response_time_ms: 120,
        status: 'ok',
        url: 'https://usebaci.com/api/chat',
      },
    });
    expect(body.merchants[0].action_health.requests).not.toHaveProperty(
      'records'
    );
    expect(supabase.__mocks.merchantQuery.select).toHaveBeenCalledWith(
      'id, slug, business_name, is_published'
    );
    expect(supabase.__mocks.merchantQuery.in).toHaveBeenCalledWith('slug', [
      'ogabassey',
    ]);
    expect(checkAgentCommerceManifestHealth).toHaveBeenCalledWith({
      custom_domain: 'ogabassey.com',
      slug: 'ogabassey',
    });
    expect(loadAgenticActionHealth).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      { recordsSource: 'admin_direct' }
    );
    expect(checkAgentCommerceFeedHealth).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      slug: 'ogabassey',
      supabase,
    });
    expect(checkAgentCommerceTrustHealth).toHaveBeenCalledWith({
      custom_domain: 'ogabassey.com',
      slug: 'ogabassey',
    });
    expect(checkAgentCommercePublicProductParity).toHaveBeenCalledWith({
      custom_domain: 'ogabassey.com',
      slug: 'ogabassey',
    });
    expect(checkAgentCommerceUniversalCartReadiness).toHaveBeenCalledWith({
      custom_domain: 'ogabassey.com',
      slug: 'ogabassey',
    });
    expect(checkAgentCommerceSupportChatHealth).toHaveBeenCalledOnce();
    expect(supabase.__mocks.crawlerQuery.select).toHaveBeenCalledWith(
      'agent_family, bot_name, cache_outcome, crawled_at, host, response_time_ms, status_code, url_path, user_agent'
    );
    expect(supabase.__mocks.crawlerQuery.eq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
  });
});
