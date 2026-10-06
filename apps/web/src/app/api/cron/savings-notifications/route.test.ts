import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const worker = vi.hoisted(() => vi.fn());
vi.mock('@/lib/savings-notifications/push-worker-runtime', () => ({
  runSavingsNotificationPushWorker: worker,
}));

import { GET } from './route';

describe('GET /api/cron/savings-notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('SAVINGS_NOTIFICATIONS_ENABLED', 'true');
    worker.mockResolvedValue({
      enabled: true,
      enqueued: 2,
      claimed: 2,
      accepted: 1,
      rejected: 1,
      unknown: 0,
      finishFailed: 0,
    });
  });

  it('authenticates before invoking the isolated worker', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/cron/savings-notifications')
    );

    expect(response.status).toBe(401);
    expect(worker).not.toHaveBeenCalled();
  });

  it('returns aggregate dispatch counts for an authenticated request', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/cron/savings-notifications', {
        headers: { authorization: 'Bearer cron-secret' },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      accepted: 1,
      rejected: 1,
      unknown: 0,
    });
    expect(worker).toHaveBeenCalledOnce();
  });

  it('fails closed without enabling or invoking the worker when cron config is missing', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await GET(
      new NextRequest('http://localhost/api/cron/savings-notifications')
    );

    expect(response.status).toBe(401);
    expect(worker).not.toHaveBeenCalled();
  });
});
