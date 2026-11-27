import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  resolve: vi.fn(),
  update: vi.fn(),
  csrf: vi.fn(),
  read: vi.fn(),
  version: vi.fn(),
}));

vi.mock('@/lib/chatwoot/merchant-inbox-request', () => ({
  resolveMerchantInboxRequest: mocks.resolve,
  merchantInboxError: (status: number, error: string, code: string) =>
    NextResponse.json({ error, code }, { status }),
  merchantInboxJson: (body: unknown) => NextResponse.json(body),
}));
vi.mock('@/lib/chatwoot/merchant-inbox-client', () => ({
  getMerchantInboxConversation: mocks.read,
}));
vi.mock('@/lib/chatwoot/merchant-inbox-manage-client', () => ({
  updateMerchantInboxConversation: mocks.update,
}));
vi.mock('@/lib/chatwoot/chat-follow-up-reminder-version', () => ({
  readChatFollowUpReminderVersion: mocks.version,
}));
vi.mock('@/lib/chatwoot/chat-follow-up-reminder-sync', () => ({
  syncChatFollowUpReminder: mocks.sync,
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));

import { PATCH } from './route';

const binding = { merchantId: 'm', accountId: 2, inboxId: 20 };
const supabase = { marker: 'session-client' };
const seen = { revision: 'rev-1', dueAt: '2026-11-25T08:00:00.000Z' };

function patch(conversationId: string, body: unknown, raw = false) {
  return PATCH(
    new NextRequest(
      `https://app.example.test/api/merchant/inbox/conversations/${conversationId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: raw ? String(body) : JSON.stringify(body),
      }
    ),
    { params: Promise.resolve({ conversationId }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.resolve.mockResolvedValue({ ok: true, binding, supabase });
  mocks.sync.mockResolvedValue('unchanged');
  mocks.version.mockResolvedValue(seen);
  mocks.read.mockResolvedValue({
    ok: true,
    conversation: { id: 7, customerName: 'Ada', status: 'open' },
  });
  mocks.update.mockResolvedValue({
    ok: true,
    conversation: {
      id: 7,
      customerName: 'Ada',
      status: 'snoozed',
      followUp: true,
      snoozedUntil: '2026-11-25T09:00:00.000Z',
    },
  });
});

describe('PATCH /api/merchant/inbox/conversations/[conversationId]', () => {
  it('applies a validated change for the session merchant', async () => {
    const response = await patch('7', {
      status: 'resolved',
      addTags: ['Order Issue'],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      conversation: {
        id: 7,
        customerName: 'Ada',
        status: 'snoozed',
        followUp: true,
        snoozedUntil: '2026-11-25T09:00:00.000Z',
      },
    });
    expect(mocks.resolve).toHaveBeenCalledWith(expect.anything(), 'edit');
    expect(mocks.update).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      update: { status: 'resolved', addTags: ['order-issue'] },
    });
  });

  it('records the reminder under the caller session after the engine accepts a follow-up', async () => {
    const response = await patch('7', { followUpAt: '2026-11-25T09:00:00Z' });

    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith(supabase, {
      merchantId: 'm',
      conversationId: 7,
      update: { followUpAt: '2026-11-25T09:00:00Z' },
      customerName: 'Ada',
      seen,
      recheck: expect.any(Function),
      observed: {
        status: 'snoozed',
        followUp: true,
        snoozedUntil: '2026-11-25T09:00:00.000Z',
      },
    });
  });

  it('bugfix: reads the reminder version before changing the chat', async () => {
    await patch('7', { followUpAt: '2026-11-25T09:00:00Z' });

    expect(mocks.version).toHaveBeenCalledWith(supabase, {
      merchantId: 'm',
      conversationId: 7,
    });
    expect(mocks.version.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.update.mock.invocationCallOrder[0]
    );
  });

  it('does not read the reminder for a change that cannot touch it', async () => {
    await patch('7', { priority: 'high' });
    expect(mocks.version).not.toHaveBeenCalled();
  });

  it('still answers success when the reminder could not be recorded', async () => {
    mocks.sync.mockResolvedValue('failed');
    expect((await patch('7', { followUpAt: null })).status).toBe(200);
  });

  it('leaves the reminder alone when the engine refused the change', async () => {
    mocks.update.mockResolvedValue({ ok: false, code: 'unavailable' });
    expect(
      (await patch('7', { followUpAt: '2026-11-25T09:00:00Z' })).status
    ).toBe(503);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('bugfix: records the reminder when the follow-up was applied but a later field failed', async () => {
    mocks.update.mockResolvedValue({ ok: false, code: 'unavailable' });
    const snoozed = {
      status: 'snoozed',
      followUp: true,
      snoozedUntil: '2026-11-25T09:00:00.000Z',
    };
    mocks.read.mockResolvedValue({
      ok: true,
      conversation: { id: 7, customerName: 'Ada', ...snoozed },
    });
    const update = {
      followUpAt: '2026-11-25T09:00:00Z',
      priority: 'high',
    };

    expect((await patch('7', update)).status).toBe(503);
    expect(mocks.sync).toHaveBeenCalledWith(supabase, {
      merchantId: 'm',
      conversationId: 7,
      update,
      customerName: 'Ada',
      seen,
      recheck: expect.any(Function),
      observed: snoozed,
    });
  });

  it('bugfix: records an applied follow-up when the chat cannot be read back', async () => {
    mocks.update.mockResolvedValue({
      ok: false,
      code: 'unavailable',
      followUpSent: { state: 'applied', customerName: 'Ada' },
    });
    mocks.read.mockResolvedValue({ ok: false, code: 'unavailable' });

    const update = { followUpAt: '2026-11-25T09:00:00Z' };
    expect((await patch('7', update)).status).toBe(503);
    expect(mocks.sync).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ update, customerName: 'Ada' })
    );
  });

  it('bugfix: drops the reminder when a clear reopened the chat but a later write failed', async () => {
    mocks.update.mockResolvedValue({
      ok: false,
      code: 'unavailable',
      followUpCancelSent: 'applied',
    });

    expect((await patch('7', { followUpAt: null })).status).toBe(503);
    expect(mocks.sync).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ update: { followUpAt: null } })
    );
  });

  it.each([
    ['an empty change', {}],
    ['an unknown key', { status: 'open', merchantId: 'other' }],
    ['a bad priority', { priority: 'critical' }],
    [
      'a finished chat with a follow-up',
      {
        status: 'resolved',
        followUpAt: '2026-11-23T08:00:00.000Z',
      },
    ],
    ['a tag with nothing usable', { addTags: ['!!!'] }],
    ['too many new tags', { addTags: ['a', 'b', 'c', 'd', 'e', 'f'] }],
  ])('rejects %s without touching the provider', async (_name, body) => {
    expect((await patch('7', body)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON and a bad id', async () => {
    expect((await patch('7', 'not json', true)).status).toBe(400);
    expect((await patch('abc', { status: 'open' })).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('refuses a forged request before any auth or provider work', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });
    expect((await patch('7', { status: 'open' })).status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('answers an unauthenticated caller before reading input', async () => {
    mocks.resolve.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: 'unauthorized' }, { status: 401 }),
    });
    expect((await patch('7', {})).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 404],
    ['invalid_follow_up', 400],
    ['unavailable', 503],
  ])('maps %s to %i', async (code, status) => {
    mocks.update.mockResolvedValue({ ok: false, code });
    expect((await patch('7', { status: 'open' })).status).toBe(status);
  });
});
