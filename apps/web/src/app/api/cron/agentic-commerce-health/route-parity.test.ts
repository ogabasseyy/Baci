import { beforeEach, describe, expect, it, vi } from 'vitest';

const { GET } = await import('./route');

import { routeTestHarness } from './route.test-setup';

const { attentionAction, createCronRequest } = routeTestHarness;

const { loadAgenticActionHealth, checkAgentCommerceTrustHealth } =
  routeTestHarness.mocks;

describe('GET /api/cron/agentic-commerce-health', () => {
  beforeEach(() => {
    routeTestHarness.reset();
  });

  it('keeps attention status reasons ahead of trust readiness warnings', async () => {
    vi.mocked(loadAgenticActionHealth).mockResolvedValue({
      actions: [attentionAction],
      generated_at: '2026-05-22T03:00:00.000Z',
    });
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
          status: 'attention',
          status_reason: 'agentic_action_health_attention',
        },
      ],
      status: 'attention',
    });
  });
});
