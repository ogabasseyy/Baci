import { describe, expect, it, vi } from 'vitest';

const mockRouteGet = vi.fn();

vi.mock('dotenv/config', () => ({}));
vi.mock('@/env', () => ({ getCronSecret: () => 'test-secret' }));
vi.mock('@/app/api/cron/agentic-commerce-health/route', () => ({
  GET: (...args: unknown[]) => mockRouteGet(...args),
}));

import { runAgenticCommerceHealthCli } from './agentic-commerce-health';

describe('agentic-commerce-health CLI', () => {
  it('returns 0 when route succeeds and 1 when route returns >= 400', async () => {
    mockRouteGet.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await expect(runAgenticCommerceHealthCli()).resolves.toBe(0);

    mockRouteGet.mockResolvedValueOnce(new Response('fail', { status: 500 }));
    await expect(runAgenticCommerceHealthCli()).resolves.toBe(1);
  });
});
