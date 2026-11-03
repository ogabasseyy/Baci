import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
}));
vi.mock('@/lib/piggyvest/daily-reconciliation-runtime', () => ({
  runPiggyvestDailyReconciliation: mocks.run,
}));

import { GET } from './route';

const SECRET = createHash('sha256').update('cron-secret').digest('hex');
const request = (headers: Record<string, string> = {}) =>
  new Request('https://example.test/api/cron/piggyvest-daily-reconciliation', {
    headers,
  });

const ORIGINAL_SECRET = process.env.CRON_SECRET;
afterAll(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
});

describe('GET /api/cron/piggyvest-daily-reconciliation', () => {
  it.each([
    ['no credential', {}],
    ['a wrong bearer', { authorization: 'Bearer wrong' }],
  ])('rejects %s before running anything', async (_l, headers) => {
    const response = await GET(request(headers));
    expect(response.status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('rejects every request when no cron secret is configured', async () => {
    process.env.CRON_SECRET = '';
    const response = await GET(request({ authorization: 'Bearer ' }));
    expect(response.status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('returns a disabled run as a plain 200', async () => {
    mocks.run.mockResolvedValue({ status: 'disabled' });
    const response = await GET(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'disabled' });
  });

  it('returns the report summary: 200 when clean, 200 when it paged (the page is the signal)', async () => {
    mocks.run.mockResolvedValue({
      status: 'reported',
      report: 'attention',
      emailed: true,
      paged: true,
    });
    const response = await GET(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'reported',
      report: 'attention',
      emailed: true,
      paged: true,
    });
  });

  it('answers 500 with a safe body when the run itself throws', async () => {
    mocks.run.mockRejectedValue(new Error('secret detail'));
    const response = await GET(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Reconciliation failed' });
  });
});
