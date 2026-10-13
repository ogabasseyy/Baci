import { NextRequest } from 'next/server';
import { vi } from 'vitest';

vi.mock('@/env', () => ({
  getCronSecret: vi.fn(() => 'cron-secret'),
  getRootDomain: vi.fn(() => 'usebaci.com'),
}));
vi.mock('@/lib/agentic/action-health-loader', () => ({
  loadAgenticActionHealth: vi.fn(),
}));
vi.mock('@/lib/agentic/agent-commerce-manifest-health', () => ({
  checkAgentCommerceManifestHealth: vi.fn(),
}));
vi.mock('@/lib/agentic/agent-commerce-health-monitor', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/agentic/agent-commerce-health-monitor')
  >('@/lib/agentic/agent-commerce-health-monitor');

  return {
    ...actual,
    checkAgentCommerceUniversalCartReadiness: vi.fn(),
  };
});
vi.mock(
  '@/lib/agentic/agent-commerce-public-product-parity-health',
  async () => {
    const actual = await vi.importActual<
      typeof import('@/lib/agentic/agent-commerce-public-product-parity-health')
    >('@/lib/agentic/agent-commerce-public-product-parity-health');

    return {
      ...actual,
      checkAgentCommercePublicProductParity: vi.fn(),
    };
  }
);
vi.mock('@/lib/agentic/agent-commerce-feed-health', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/agentic/agent-commerce-feed-health')
  >('@/lib/agentic/agent-commerce-feed-health');

  return {
    ...actual,
    checkAgentCommerceFeedHealth: vi.fn(),
  };
});
vi.mock('@/lib/agentic/agent-commerce-support-chat-health', () => ({
  checkAgentCommerceSupportChatHealth: vi.fn(),
}));
vi.mock('@/lib/agentic/agent-commerce-trust-health', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/agentic/agent-commerce-trust-health')
  >('@/lib/agentic/agent-commerce-trust-health');

  return {
    ...actual,
    checkAgentCommerceTrustHealth: vi.fn(),
  };
});
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { getCronSecret } from '@/env';
import { loadAgenticActionHealth } from '@/lib/agentic/action-health-loader';
import { checkAgentCommerceFeedHealth } from '@/lib/agentic/agent-commerce-feed-health';
import { checkAgentCommerceUniversalCartReadiness } from '@/lib/agentic/agent-commerce-health-monitor';
import { checkAgentCommerceManifestHealth } from '@/lib/agentic/agent-commerce-manifest-health';
import { checkAgentCommercePublicProductParity } from '@/lib/agentic/agent-commerce-public-product-parity-health';
import { checkAgentCommerceSupportChatHealth } from '@/lib/agentic/agent-commerce-support-chat-health';
import { checkAgentCommerceTrustHealth } from '@/lib/agentic/agent-commerce-trust-health';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/supabase/admin';

const healthyAction = {
  code: 'AGENTIC_ACTIONS_HEALTHY',
  count: 0,
  message: 'No recent agentic action issues need attention.',
  next_step: 'No action required right now.',
  severity: 'ok' as const,
};
const monitorAction = {
  code: 'AGENTIC_PAYMENT_PENDING',
  count: 1,
  message: 'Agentic checkouts are waiting for payment confirmation.',
  next_step: 'Confirm payment provider webhook status.',
  severity: 'monitor' as const,
};
const attentionAction = {
  code: 'AGENTIC_PAYMENT_SETUP_FAILED',
  count: 1,
  message: 'Agentic checkouts failed while setting up payment collection.',
  next_step: 'Fix payment setup.',
  severity: 'attention' as const,
};
function createCronRequest({
  auth = 'Bearer cron-secret',
  search = '',
}: {
  auth?: string | null;
  search?: string;
} = {}) {
  return new NextRequest(
    `http://localhost:3000/api/cron/agentic-commerce-health${search}`,
    {
      headers: auth ? { authorization: auth } : {},
      method: 'GET',
    }
  );
}
function createSupabaseMock({
  crawlerError = null,
  crawlerRows = [
    {
      agent_family: 'openai',
      bot_name: 'OpenAI',
      cache_outcome: 'hit',
      crawled_at: '2026-05-22T10:00:00.000Z',
      host: 'ogabassey.com',
      response_time_ms: 120,
      status_code: 200,
      url_path: '/agent-commerce.json',
      user_agent: 'GPTBot/1.0',
    },
  ],
  merchantRows = [
    {
      business_name: 'Ogabassey',
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
    },
  ],
  merchantsError = null,
}: {
  crawlerError?: unknown;
  crawlerRows?: unknown[];
  merchantRows?: Array<{
    business_name: string;
    id: string;
    is_published: boolean;
    slug: string;
  }>;
  merchantsError?: unknown;
} = {}) {
  const domainQuery = {
    eq: vi.fn(),
    in: vi.fn(),
    select: vi.fn(),
  };
  domainQuery.select.mockReturnValue(domainQuery);
  domainQuery.in.mockReturnValue(domainQuery);
  domainQuery.eq.mockImplementationOnce(() => domainQuery);
  domainQuery.eq.mockResolvedValueOnce({
    data: [{ domain: 'ogabassey.com', merchant_id: 'merchant-1' }],
    error: null,
  });

  const merchantQuery = {
    in: vi.fn().mockResolvedValue({
      data: merchantRows,
      error: merchantsError,
    }),
    select: vi.fn(),
  };
  merchantQuery.select.mockReturnValue(merchantQuery);

  const crawlerQuery = {
    eq: vi.fn(),
    gte: vi.fn(),
    limit: vi.fn().mockResolvedValue({
      data: crawlerRows,
      error: crawlerError,
    }),
    order: vi.fn(),
    select: vi.fn(),
  };
  crawlerQuery.select.mockReturnValue(crawlerQuery);
  crawlerQuery.eq.mockReturnValue(crawlerQuery);
  crawlerQuery.gte.mockReturnValue(crawlerQuery);
  crawlerQuery.order.mockReturnValue(crawlerQuery);

  return {
    from: vi.fn((table: string) => {
      if (table === 'domains') return domainQuery;
      if (table === 'merchants') return merchantQuery;
      if (table === 'crawler_logs') return crawlerQuery;
      throw new Error(`Unexpected table: ${table}`);
    }),
    __mocks: {
      crawlerQuery,
      merchantQuery,
    },
  };
}
function resetRouteMocks() {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.mocked(getCronSecret).mockReturnValue('cron-secret');
  vi.mocked(checkAgentCommerceManifestHealth).mockResolvedValue({
    issue_count: 0,
    issues: [],
    status: 'ok',
    url: 'https://ogabassey.com/agent-commerce.json',
  });
  vi.mocked(checkAgentCommerceFeedHealth).mockResolvedValue({
    google_product_count: 2,
    issue_count: 0,
    issues: [],
    latest_product_updated_at: '2026-05-22T10:00:00.000Z',
    openai_product_count: 2,
    shared_product_count: 2,
    stale_product_count: 0,
    status: 'ok',
  });
  vi.mocked(checkAgentCommerceSupportChatHealth).mockResolvedValue({
    issue_count: 0,
    issues: [],
    response_time_ms: 120,
    status: 'ok',
    url: 'https://usebaci.com/api/chat',
  });
  vi.mocked(checkAgentCommerceTrustHealth).mockResolvedValue({
    issue_count: 0,
    issues: [],
    status: 'ok',
    url: 'https://ogabassey.com/agent-trust.json',
  });
  vi.mocked(checkAgentCommercePublicProductParity).mockResolvedValue({
    issue_count: 0,
    issues: [],
    sample_product_id: 'product-1',
    status: 'ok',
    surfaces: {
      agent_products: 'https://ogabassey.com/feeds/agent-products.jsonl',
      google_merchant_xml: 'https://ogabassey.com/feeds/google-merchant.xml',
      product_api:
        'https://ogabassey.com/api/storefront/ogabassey/products?limit=10',
      product_page: 'https://ogabassey.com/phones/test-phone',
    },
  });
  vi.mocked(checkAgentCommerceUniversalCartReadiness).mockResolvedValue({
    checks: [],
    lastCheckedAt: '2026-05-26T12:00:00.000Z',
    status: 'pass',
    url: 'https://ogabassey.com/.well-known/ucp',
  });
  vi.mocked(loadAgenticActionHealth).mockResolvedValue({
    actions: [healthyAction],
    generated_at: '2026-05-22T03:00:00.000Z',
    requests: {
      recent_count: 1,
      records: [
        {
          agent_id: 'openai:chatgpt',
          api_version: '2026-04-28',
          created_at: '2026-05-22T08:03:00.000Z',
          expires_at: '2026-05-22T08:18:00.000Z',
          route: 'checkout_sessions.complete',
        },
      ],
    },
  });
  vi.mocked(createAdminClient).mockReturnValue(createSupabaseMock() as never);
}

export const routeTestHarness = {
  attentionAction,
  createCronRequest,
  createSupabaseMock,
  healthyAction,
  monitorAction,
  reset: resetRouteMocks,
  mocks: {
    checkAgentCommerceFeedHealth,
    checkAgentCommerceManifestHealth,
    checkAgentCommercePublicProductParity,
    checkAgentCommerceSupportChatHealth,
    checkAgentCommerceTrustHealth,
    checkAgentCommerceUniversalCartReadiness,
    createAdminClient,
    getCronSecret,
    loadAgenticActionHealth,
    logger,
  },
};
