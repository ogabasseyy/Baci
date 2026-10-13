import { beforeEach, describe, expect, it, vi } from 'vitest';

const { GET } = await import('./route');

import { routeTestHarness } from './route.test-setup';

const { createCronRequest } = routeTestHarness;

const { checkAgentCommerceFeedHealth } = routeTestHarness.mocks;

describe('GET /api/cron/agentic-commerce-health', () => {
  beforeEach(() => {
    routeTestHarness.reset();
  });

  it('keeps stale feed products as monitor-only actions', async () => {
    vi.mocked(checkAgentCommerceFeedHealth).mockResolvedValue({
      google_product_count: 2,
      issue_count: 1,
      issues: [
        {
          code: 'feed_stale',
          count: 1,
          message:
            'One or more agent-visible products have stale or missing feed timestamps.',
          severity: 'monitor',
        },
      ],
      latest_product_updated_at: '2026-04-01T10:00:00.000Z',
      openai_product_count: 2,
      shared_product_count: 2,
      stale_product_count: 1,
      status: 'monitor',
    });

    const response = await GET(createCronRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      merchants: [
        {
          actions: [
            {
              code: 'AGENTIC_FEED_STALE_PRODUCTS',
              count: 1,
              severity: 'monitor',
            },
          ],
          feeds: {
            stale_product_count: 1,
            status: 'monitor',
          },
          status: 'monitor',
        },
      ],
      status: 'monitor',
    });
  });
});
