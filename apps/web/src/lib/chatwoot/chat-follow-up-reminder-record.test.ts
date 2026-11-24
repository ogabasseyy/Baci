import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mocks.rpc }),
}));

import {
  buildChatFollowUpRecordProof,
  recordChatFollowUpReminder,
} from './chat-follow-up-reminder-record';

const SECRET = 'synthetic-chat-event-secret-0123456789abcdef';
const env = {
  EKAETTE_CHAT_EVENT_RPC_SECRET: SECRET,
} as unknown as NodeJS.ProcessEnv;
const MERCHANT = 'c4a70000-0000-4000-8000-0000000000b1';
const REMINDER = '5f2d3c1e-8a47-4b69-9c0e-1a2b3c4d5e6f';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildChatFollowUpRecordProof', () => {
  // See the list test: the same vectors are asserted by the database suite.
  it('matches the vector the database suite checks (record)', () => {
    expect(
      buildChatFollowUpRecordProof(SECRET, 1794730000, {
        merchantId: MERCHANT,
        reminderId: REMINDER,
        send: true,
      })
    ).toBe('4e67154cc3b925f3f376fa1a7acc59af9e413c3047a04b16306e5985f6183518');
  });

  it('binds the send decision, so a stale answer cannot be flipped', () => {
    const input = { merchantId: MERCHANT, reminderId: REMINDER };
    expect(
      buildChatFollowUpRecordProof(SECRET, 1, { ...input, send: true })
    ).not.toBe(
      buildChatFollowUpRecordProof(SECRET, 1, { ...input, send: false })
    );
  });
});

describe('recordChatFollowUpReminder', () => {
  const input = { merchantId: MERCHANT, reminderId: REMINDER, send: true };

  it('takes the reminder and returns the outcome', async () => {
    mocks.rpc.mockResolvedValue({ data: { outcome: 'notified' }, error: null });

    await expect(recordChatFollowUpReminder(input, env)).resolves.toEqual({
      ok: true,
      outcome: 'notified',
    });
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe('record_chat_follow_up_reminder');
    expect(args).toMatchObject({
      p_merchant_id: MERCHANT,
      p_reminder_id: REMINDER,
      p_send: true,
    });
  });

  it('refuses an outcome it does not know', async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: 'coalesced' },
      error: null,
    });
    await expect(recordChatFollowUpReminder(input, env)).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });

  it('does nothing without the server secret', async () => {
    await expect(
      recordChatFollowUpReminder(input, {} as NodeJS.ProcessEnv)
    ).resolves.toEqual({ ok: false, code: 'not_configured' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('reports a database error as unavailable', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    await expect(recordChatFollowUpReminder(input, env)).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });
});
