import { beforeEach, describe, expect, it, vi } from 'vitest';

const { GET } = await import('./route');

import { routeTestHarness } from './route.test-setup';

const { attentionAction, createCronRequest, monitorAction } = routeTestHarness;

const { loadAgenticActionHealth } = routeTestHarness.mocks;

describe('GET /api/cron/agentic-commerce-health', () => {
  beforeEach(() => {
    routeTestHarness.reset();
  });

  it('fails the response when an explicit diagnostic request opts in', async () => {
    vi.mocked(loadAgenticActionHealth).mockResolvedValue({
      actions: [attentionAction],
      generated_at: '2026-05-22T03:00:00.000Z',
    });

    const response = await GET(
      createCronRequest({ search: '?fail_on_attention=true' })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      merchants: [{ status: 'attention' }],
      status: 'attention',
    });
  });

  it('keeps monitor-only actions as a successful cron response', async () => {
    vi.mocked(loadAgenticActionHealth).mockResolvedValue({
      actions: [monitorAction],
      generated_at: '2026-05-22T03:00:00.000Z',
    });

    const response = await GET(createCronRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      merchants: [
        {
          actions: [
            {
              code: 'AGENTIC_PAYMENT_PENDING',
              count: 1,
              severity: 'monitor',
            },
          ],
          status: 'monitor',
        },
      ],
      status: 'monitor',
    });
  });
});
