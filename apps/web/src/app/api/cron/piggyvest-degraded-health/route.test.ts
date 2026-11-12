import { beforeEach, describe, expect, it, vi } from 'vitest';

const run = vi.fn();
vi.mock('@/lib/piggyvest/degraded-health-runtime', () => ({
  runPiggyvestDegradedHealth: (...a: unknown[]) => run(...a),
}));

import { GET } from './route';

const call = (secret?: string) =>
  GET(
    new Request('http://x/api/cron/piggyvest-degraded-health', {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    })
  );

describe('GET /api/cron/piggyvest-degraded-health', () => {
  beforeEach(() => {
    run.mockReset();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
  });

  it('returns 401 without the cron secret', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('wrong')).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('answers disabled while the switch is off', async () => {
    run.mockResolvedValue({ status: 'disabled' });
    const res = await call('cron-secret');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'disabled' });
  });

  it('returns counts only when enabled', async () => {
    const body = {
      status: 'checked',
      stalledGoalWallets: 1,
      indeterminateTransfers: 3,
      readFailed: false,
      alerts: 2,
      paged: 2,
    };
    run.mockResolvedValue(body);
    expect(await (await call('cron-secret')).json()).toEqual(body);
  });

  it('returns 500 without detail when the check throws', async () => {
    run.mockRejectedValue(new Error('secret db detail'));
    const res = await call('cron-secret');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Health check failed' });
  });
});
