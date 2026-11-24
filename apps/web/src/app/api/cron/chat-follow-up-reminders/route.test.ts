import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sweep: vi.fn() }));
vi.mock('@/lib/chatwoot/chat-follow-up-reminder-sweep', () => ({
  sweepChatFollowUpReminders: mocks.sweep,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { GET } from './route';

const SECRET = 'cron-secret-for-follow-up-tests';
const call = (headers: Record<string, string> = {}) =>
  GET(
    new Request('https://app.example.test/api/cron/chat-follow-up-reminders', {
      headers,
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', SECRET);
  mocks.sweep.mockResolvedValue({
    ok: true,
    summary: { due: 1, sent: 1, skipped: 0, waiting: 0, failed: 0 },
  });
});

describe('GET /api/cron/chat-follow-up-reminders', () => {
  it('returns 401 without the cron secret and does nothing', async () => {
    expect((await call()).status).toBe(401);
    expect(mocks.sweep).not.toHaveBeenCalled();
  });

  it('returns 401 for a wrong secret', async () => {
    expect((await call({ authorization: 'Bearer nope' })).status).toBe(401);
    expect(mocks.sweep).not.toHaveBeenCalled();
  });

  it('returns 401 when no secret is configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call({ authorization: 'Bearer ' })).status).toBe(401);
    expect(mocks.sweep).not.toHaveBeenCalled();
  });

  it('runs the sweep for the right secret and returns its counts', async () => {
    const response = await call({ authorization: `Bearer ${SECRET}` });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      due: 1,
      sent: 1,
      skipped: 0,
      waiting: 0,
      failed: 0,
    });
  });

  it('answers 500 when the sweep cannot start', async () => {
    mocks.sweep.mockResolvedValue({ ok: false, code: 'unavailable' });
    expect((await call({ authorization: `Bearer ${SECRET}` })).status).toBe(
      500
    );
  });

  it('answers 503 when the chat secret is not provisioned', async () => {
    mocks.sweep.mockResolvedValue({ ok: false, code: 'not_configured' });
    expect((await call({ authorization: `Bearer ${SECRET}` })).status).toBe(
      503
    );
  });

  it('answers 500 when the sweep throws', async () => {
    mocks.sweep.mockRejectedValue(new Error('boom'));
    expect((await call({ authorization: `Bearer ${SECRET}` })).status).toBe(
      500
    );
  });
});
