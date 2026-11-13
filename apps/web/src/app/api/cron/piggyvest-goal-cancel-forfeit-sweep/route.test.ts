import { createHash } from 'node:crypto';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sweep: vi.fn() }));
vi.mock('@/lib/piggyvest/goal-cancel-forfeit-cron', () => ({
  runScheduledGoalCancelForfeitSweep: mocks.sweep,
}));

import { GET } from './route';

const SECRET = createHash('sha256').update('cron-secret-sweep').digest('hex');
const request = (headers: Record<string, string> = {}) =>
  new Request(
    'https://example.test/api/cron/piggyvest-goal-cancel-forfeit-sweep',
    {
      headers,
    }
  );
const authorized = () => request({ authorization: `Bearer ${SECRET}` });
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

it('rejects a request without the cron secret before sweeping', async () => {
  const response = await GET(request());
  expect(response.status).toBe(401);
  expect(mocks.sweep).not.toHaveBeenCalled();
});

it('sweeps with its own full time budget and reports counts only', async () => {
  mocks.sweep.mockResolvedValue(counts);
  const before = Date.now();
  const response = await GET(authorized());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok', forfeitSweep: counts });
  const deadline = mocks.sweep.mock.calls[0][2] as number;
  expect(deadline).toBeGreaterThanOrEqual(before + 120_000);
  expect(deadline).toBeLessThanOrEqual(Date.now() + 120_000);
});

it('answers inert where the savings credentials are not configured', async () => {
  mocks.sweep.mockResolvedValue(null);
  expect(await (await GET(authorized())).json()).toEqual({ status: 'inert' });
});

it('reports a failed sweep as a 500', async () => {
  mocks.sweep.mockResolvedValue({ status: 'failed' });
  const response = await GET(authorized());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ status: 'failed' });
});
