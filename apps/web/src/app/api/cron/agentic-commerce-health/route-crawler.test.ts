import { beforeEach, describe, expect, it, vi } from 'vitest';

const { GET } = await import('./route');

import { routeTestHarness } from './route.test-setup';

const { createCronRequest, createSupabaseMock } = routeTestHarness;

const { createAdminClient } = routeTestHarness.mocks;

describe('GET /api/cron/agentic-commerce-health', () => {
  beforeEach(() => {
    routeTestHarness.reset();
  });

  it('reports failing crawler visits without failing the scheduled cron response', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      createSupabaseMock({
        crawlerRows: [
          {
            agent_family: 'openai',
            bot_name: 'OpenAI',
            cache_outcome: 'miss',
            crawled_at: '2026-05-22T10:00:00.000Z',
            host: 'ogabassey.com',
            response_time_ms: 120,
            status_code: 500,
            url_path: '/agent-commerce.json',
            user_agent: 'GPTBot/1.0',
          },
        ],
      }) as never
    );

    const response = await GET(createCronRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      merchants: [
        {
          actions: [
            {
              code: 'AGENTIC_CRAWLER_FETCH_FAILURES',
              count: 1,
              severity: 'attention',
            },
          ],
          crawler: {
            issue_count: 1,
            status: 'attention',
          },
          status: 'attention',
          status_reason: 'agent_commerce_crawler_fetch_failures',
        },
      ],
      status: 'attention',
    });
  });

  it('reports unavailable crawler visibility logs without failing the scheduled cron response', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      createSupabaseMock({
        crawlerError: new Error('query failed'),
      }) as never
    );

    const response = await GET(createCronRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      merchants: [
        {
          actions: [
            {
              code: 'AGENTIC_CRAWLER_VISIBILITY_UNAVAILABLE',
              count: 1,
              severity: 'attention',
            },
          ],
          crawler: {
            issue_count: 1,
            status: 'attention',
          },
          status: 'attention',
          status_reason: 'agent_commerce_crawler_log_unavailable',
        },
      ],
      status: 'attention',
    });
  });
});
