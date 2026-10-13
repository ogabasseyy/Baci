import { beforeEach, describe, expect, it, vi } from 'vitest';

const { GET } = await import('./route');

import { routeTestHarness } from './route.test-setup';

const { createCronRequest } = routeTestHarness;

const {
  checkAgentCommerceUniversalCartReadiness,
  checkAgentCommerceSupportChatHealth,
  logger,
} = routeTestHarness.mocks;

describe('GET /api/cron/agentic-commerce-health', () => {
  beforeEach(() => {
    routeTestHarness.reset();
  });

  it('reports support chat provider failure without failing commerce status', async () => {
    vi.mocked(checkAgentCommerceSupportChatHealth).mockResolvedValue({
      issue_count: 1,
      issues: [
        {
          code: 'support_chat_static_fallback',
          message:
            'Support chat returned its static provider-failure fallback.',
        },
      ],
      response_time_ms: 125,
      status: 'attention',
      url: 'https://usebaci.com/api/chat',
    });

    const response = await GET(createCronRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      support_chat: {
        issue_count: 1,
        status: 'attention',
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Support chat health monitor needs attention',
      })
    );
  });

  it('reports Universal Cart readiness failures without failing the scheduled cron response', async () => {
    vi.mocked(checkAgentCommerceUniversalCartReadiness).mockResolvedValue({
      checks: [
        {
          id: 'ucp_cart_capability',
          message: 'Cart capability is missing.',
          status: 'fail',
        },
      ],
      lastCheckedAt: '2026-05-26T12:00:00.000Z',
      status: 'fail',
      url: 'https://ogabassey.com/.well-known/ucp',
    });

    const response = await GET(createCronRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      merchants: [
        {
          actions: [
            {
              code: 'AGENT_COMMERCE_UNIVERSAL_CART_NOT_READY',
              count: 1,
              severity: 'attention',
            },
          ],
          status: 'attention',
          status_reason: 'agent_commerce_universal_cart_not_ready',
          universal_cart: {
            status: 'fail',
          },
        },
      ],
      status: 'attention',
    });
  });
});
