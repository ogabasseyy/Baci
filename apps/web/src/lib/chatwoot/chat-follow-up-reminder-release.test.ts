import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mocks.rpc }),
}));

import {
  buildChatFollowUpReleaseProof,
  releaseChatFollowUpReminder,
} from './chat-follow-up-reminder-release';

const SECRET = 'synthetic-chat-event-secret-0123456789abcdef';
const env = {
  EKAETTE_CHAT_EVENT_RPC_SECRET: SECRET,
} as unknown as NodeJS.ProcessEnv;
const input = {
  merchantId: 'c4a70000-0000-4000-8000-0000000000b1',
  reminderId: '5f2d3c1e-8a47-4b69-9c0e-1a2b3c4d5e6f',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe('releaseChatFollowUpReminder', () => {
  it('builds the proof the database recomputes', () => {
    expect(buildChatFollowUpReleaseProof(SECRET, 1794730000, input)).toBe(
      '1ebb2ecdc817b0acf56d7d4af442f6373763ed165d25664731927445cb7616ac'
    );
  });

  it('asks the database to put the reminder back', async () => {
    await expect(releaseChatFollowUpReminder(input, env)).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'release_chat_follow_up_reminder',
      expect.objectContaining({
        p_merchant_id: input.merchantId,
        p_reminder_id: input.reminderId,
      })
    );
  });

  it.each([
    ['the database refuses', { data: false, error: null }],
    ['the call fails', { data: null, error: { message: 'down' } }],
  ])('answers false when %s', async (_label, answer) => {
    mocks.rpc.mockResolvedValue(answer);
    await expect(releaseChatFollowUpReminder(input, env)).resolves.toBe(false);
  });

  it('answers false instead of throwing', async () => {
    mocks.rpc.mockRejectedValue(new Error('offline'));
    await expect(releaseChatFollowUpReminder(input, env)).resolves.toBe(false);
  });

  it('does nothing without a configured secret', async () => {
    await expect(
      releaseChatFollowUpReminder(input, {} as unknown as NodeJS.ProcessEnv)
    ).resolves.toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
