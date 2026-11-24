import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mocks.rpc }),
}));

import {
  buildChatFollowUpListProof,
  listDueChatFollowUpReminders,
} from './chat-follow-up-reminder-list';

const SECRET = 'synthetic-chat-event-secret-0123456789abcdef';
const env = {
  EKAETTE_CHAT_EVENT_RPC_SECRET: SECRET,
} as unknown as NodeJS.ProcessEnv;
const MERCHANT = 'c4a70000-0000-4000-8000-0000000000b1';
const REMINDER = '5f2d3c1e-8a47-4b69-9c0e-1a2b3c4d5e6f';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildChatFollowUpListProof', () => {
  // The same vectors are asserted by supabase/tests/chat_follow_up_reminders.sql,
  // so the Node builders and the database functions cannot drift apart.
  it('matches the vector the database suite checks (list)', () => {
    expect(buildChatFollowUpListProof(SECRET, 1794730000, 25)).toBe(
      'a816a77a6ba579fedcea14c081b2a5f94726cda72358c307d14a9685505dcc6e'
    );
  });
});

describe('listDueChatFollowUpReminders', () => {
  it('asks the database with a proof and returns the checked rows', async () => {
    const row = {
      reminder_id: REMINDER,
      merchant_id: MERCHANT,
      conversation_id: 7,
      due_at: '2026-11-25T09:00:00+00:00',
      customer_name: 'Ada',
    };
    mocks.rpc.mockResolvedValue({ data: [row], error: null });

    await expect(listDueChatFollowUpReminders(env)).resolves.toEqual({
      ok: true,
      reminders: [row],
    });
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe('list_due_chat_follow_up_reminders');
    expect(args.p_limit).toBe(25);
    expect(args.p_proof).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does nothing without the server secret', async () => {
    await expect(
      listDueChatFollowUpReminders({} as NodeJS.ProcessEnv)
    ).resolves.toEqual({ ok: false, code: 'not_configured' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('reports a database error as unavailable', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    await expect(listDueChatFollowUpReminders(env)).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });

  it('refuses a malformed answer', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ reminder_id: 'nope' }],
      error: null,
    });
    await expect(listDueChatFollowUpReminders(env)).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });

  it('never throws when the client throws', async () => {
    mocks.rpc.mockRejectedValue(new Error('network'));
    await expect(listDueChatFollowUpReminders(env)).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });
});
