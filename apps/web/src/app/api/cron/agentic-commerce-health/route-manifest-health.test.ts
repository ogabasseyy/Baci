import { beforeEach, describe, expect, it, vi } from 'vitest';

const { GET } = await import('./route');

import { routeTestHarness } from './route.test-setup';

const { createCronRequest } = routeTestHarness;

const { checkAgentCommerceManifestHealth } = routeTestHarness.mocks;

describe('GET /api/cron/agentic-commerce-health manifest monitoring', () => {
  beforeEach(() => {
    routeTestHarness.reset();
  });

  it('reports public manifest capability drift without failing the scheduled cron response', async () => {
    vi.mocked(checkAgentCommerceManifestHealth).mockResolvedValue({
      issue_count: 1,
      issues: [
        {
          code: 'manifest_contract_drift',
          message: 'Manifest advertises a partial checkout capability set.',
        },
      ],
      status: 'attention',
      url: 'https://ogabassey.com/agent-commerce.json',
    });

    const response = await GET(createCronRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      merchants: [
        {
          actions: [
            {
              code: 'AGENT_COMMERCE_MANIFEST_DRIFT',
              count: 1,
              severity: 'attention',
            },
          ],
          manifest: {
            issue_count: 1,
            status: 'attention',
            url: 'https://ogabassey.com/agent-commerce.json',
          },
          status: 'attention',
          status_reason: 'agent_commerce_manifest_drift',
        },
      ],
      status: 'attention',
    });
  });

  it('reports an unavailable public manifest without failing the scheduled cron response', async () => {
    vi.mocked(checkAgentCommerceManifestHealth).mockResolvedValue({
      issue_count: 1,
      issues: [
        {
          code: 'manifest_unavailable',
          message: 'Manifest returned HTTP 404.',
        },
      ],
      status: 'attention',
      url: 'https://ogabassey.com/agent-commerce.json',
    });

    const response = await GET(createCronRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      merchants: [
        {
          actions: [
            {
              code: 'AGENT_COMMERCE_MANIFEST_UNAVAILABLE',
              count: 1,
              severity: 'attention',
            },
          ],
          manifest: {
            issue_count: 1,
            status: 'attention',
            url: 'https://ogabassey.com/agent-commerce.json',
          },
          status: 'attention',
          status_reason: 'agent_commerce_manifest_unavailable',
        },
      ],
      status: 'attention',
    });
  });
});
