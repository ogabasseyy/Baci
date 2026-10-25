import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  rate: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: m.csrf }));
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: m.rate,
}));
vi.mock('@/lib/payments/oxygen/draft-store', () => ({
  readOxygenDraft: m.read,
  saveOxygenDraft: m.save,
  OxygenDraftError: class extends Error {
    constructor(public code: string) {
      super('Private failure');
    }
  },
}));

import { OxygenDraftError } from '@/lib/payments/oxygen/draft-store';
import { GET, PUT } from './route';

const id = '60000000-0000-4000-8000-000000000001';
const body = {
  workflowId: id,
  version: 0,
  idempotencyKey: id,
  draft: { step: 0, fields: { bvn: '123' } },
};
const put = (input: unknown = body) =>
  new NextRequest('http://localhost/api/payments/oxygen/draft', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
const get = () =>
  new NextRequest(
    `http://localhost/api/payments/oxygen/draft?workflowId=${id}`
  );
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {} });
  m.csrf.mockResolvedValue({ valid: true });
  m.rate.mockResolvedValue(true);
  m.read.mockResolvedValue({ draft: null, version: 0 });
  m.save.mockResolvedValue({ version: 1 });
});
it('requires auth and CSRF before draft mutations', async () => {
  m.auth.mockResolvedValue({ error: 'Unauthorized' });
  expect((await GET(get())).status).toBe(401);
  expect((await PUT(put())).status).toBe(401);
  expect(m.read).not.toHaveBeenCalled();
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {} });
  m.csrf.mockResolvedValue({ valid: false });
  expect((await PUT(put())).status).toBe(403);
  expect(m.save).not.toHaveBeenCalled();
});
it('rejects malformed JSON and forbidden consent/OTP without saving', async () => {
  expect(
    (
      await PUT(
        new NextRequest('http://localhost/api/payments/oxygen/draft', {
          method: 'PUT',
          body: '{',
        })
      )
    ).status
  ).toBe(400);
  expect(
    (
      await PUT(
        put({
          ...body,
          draft: { step: 0, fields: { otp: '123456', consent: 'on' } },
        })
      )
    ).status
  ).toBe(400);
  expect(m.save).not.toHaveBeenCalled();
});
it('returns no-store owned drafts and versioned save acknowledgments', async () => {
  const response = await GET(get());
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({ draft: null, version: 0 });
  expect(await (await PUT(put())).json()).toEqual({ version: 1 });
  expect(m.save).toHaveBeenCalledWith({}, 'user', body);
});
it('maps ownership, conflicts and storage errors safely', async () => {
  for (const [code, status] of [
    ['not_found', 404],
    ['conflict', 409],
    ['unavailable', 503],
  ] as const) {
    m.save.mockRejectedValueOnce(new OxygenDraftError(code));
    const response = await PUT(put());
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain(
      'Private failure'
    );
  }
});
it('rate limits autosave and bounds payload size', async () => {
  m.rate.mockResolvedValue(false);
  expect((await PUT(put())).status).toBe(429);
  m.rate.mockResolvedValue(true);
  expect(
    (
      await PUT(
        new NextRequest('http://localhost/api/payments/oxygen/draft', {
          method: 'PUT',
          body: ' '.repeat(9000),
        })
      )
    ).status
  ).toBe(413);
});
