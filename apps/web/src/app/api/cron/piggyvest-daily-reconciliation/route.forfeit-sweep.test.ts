import { createHash } from 'node:crypto';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(), sweep: vi.fn() }));
vi.mock('@/lib/piggyvest/daily-reconciliation-runtime', () => ({
  runPiggyvestDailyReconciliation: mocks.run,
}));
vi.mock('@/lib/piggyvest/goal-cancel-forfeit-cron', () => ({
  runScheduledGoalCancelForfeitSweep: mocks.sweep,
}));

import { GET } from './route';

const SECRET = createHash('sha256').update('cron-secret-forfeit').digest('hex');
const request = () =>
  new Request('https://example.test/api/cron/piggyvest-daily-reconciliation', {
    headers: { authorization: `Bearer ${SECRET}` },
  });
const counts = {
  listed: 1,
  confirmed: 1,
  pending: 0,
  attention: 0,
  skipped: 0,
  failed: 0,
  deferred: 0,
};
const ORIGINAL_SECRET = process.env.CRON_SECRET;
afterAll(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET;
});
beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
});

it('reports the forfeit sweep counts beside the reconciliation report', async () => {
  mocks.sweep.mockResolvedValue(counts);
  mocks.run.mockResolvedValue({ status: 'disabled' });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: 'disabled',
    forfeitSweep: counts,
  });
});

it('keeps the sweep counts visible and logs the reason when the reconciliation fails', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mocks.sweep.mockResolvedValue(counts);
  mocks.run.mockRejectedValue(new Error('boom'));
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: 'Reconciliation failed',
    forfeitSweep: counts,
  });
  expect(warn).toHaveBeenCalledWith(
    '[PiggyVest] Daily reconciliation failed:',
    'boom'
  );
  warn.mockRestore();
});

it('leaves the report unchanged where the sweep is inert', async () => {
  mocks.sweep.mockResolvedValue(null);
  mocks.run.mockResolvedValue({ status: 'disabled' });
  expect(await (await GET(request())).json()).toEqual({ status: 'disabled' });
});

it('runs the daily report before the forfeit sweep, and bounds the sweep', async () => {
  const order: string[] = [];
  mocks.run.mockImplementation(async () => {
    order.push('report');
    return { status: 'disabled' };
  });
  mocks.sweep.mockImplementation(async () => {
    order.push('sweep');
    return counts;
  });
  const before = Date.now();
  await GET(request());
  expect(order).toEqual(['report', 'sweep']);
  const deadline = mocks.sweep.mock.calls[0][2] as number;
  expect(deadline).toBeGreaterThanOrEqual(before + 150_000);
  expect(deadline).toBeLessThan(before + 300_000);
});

it('reports a failed sweep under its own field, never in the counts shape', async () => {
  mocks.sweep.mockResolvedValue({ status: 'failed' });
  mocks.run.mockResolvedValue({ status: 'disabled' });
  expect(await (await GET(request())).json()).toEqual({
    status: 'disabled',
    forfeitSweepError: 'failed',
  });
});
