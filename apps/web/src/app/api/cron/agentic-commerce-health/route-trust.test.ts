import { beforeEach, describe, expect, it, vi } from 'vitest';

const { GET } = await import('./route');

import { routeTestHarness } from './route.test-setup';

const { createCronRequest } = routeTestHarness;

const { checkAgentCommerceTrustHealth } = routeTestHarness.mocks;

describe('GET /api/cron/agentic-commerce-health', () => {
  beforeEach(() => {
    routeTestHarness.reset();
  });

  it('keeps public trust readiness warnings as monitor-only actions', async () => {
    vi.mocked(checkAgentCommerceTrustHealth).mockResolvedValue({
      issue_count: 1,
      issues: [
        {
          check_id: 'feed-freshness',
          code: 'trust_check_warning',
          count: 1,
          message: 'One public catalog product is stale.',
          severity: 'monitor',
        },
      ],
      status: 'monitor',
      url: 'https://ogabassey.com/agent-trust.json',
    });

    const response = await GET(createCronRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      merchants: [
        {
          actions: [
            {
              code: 'AGENT_COMMERCE_TRUST_WARNING',
              count: 1,
              severity: 'monitor',
            },
          ],
          status: 'monitor',
          status_reason: 'agent_commerce_trust_warning',
        },
      ],
      status: 'monitor',
    });
  });
});
