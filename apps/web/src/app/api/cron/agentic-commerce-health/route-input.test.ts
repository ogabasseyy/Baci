import { beforeEach, describe, expect, it, vi } from 'vitest';

const { GET, maxDuration } = await import('./route');

import { routeTestHarness } from './route.test-setup';

const { createCronRequest, createSupabaseMock } = routeTestHarness;

const { logger, createAdminClient } = routeTestHarness.mocks;

describe('GET /api/cron/agentic-commerce-health', () => {
  beforeEach(() => {
    routeTestHarness.reset();
  });

  it('returns 500 when merchant lookup fails', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      createSupabaseMock({
        merchantsError: { message: 'database unavailable' },
      }) as never
    );

    const response = await GET(createCronRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: 'internal_error',
      error: 'Internal server error',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Agentic commerce health monitor failed',
      })
    );
  });

  it('allows enough time to collect agentic action health', () => {
    expect(maxDuration).toBe(300);
  });
});
