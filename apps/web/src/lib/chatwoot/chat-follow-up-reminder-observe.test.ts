import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./merchant-inbox-client', () => ({
  getMerchantInboxConversation: mocks.read,
}));

import { observeChatFollowUp } from './chat-follow-up-reminder-observe';

const binding = { merchantId: 'm' } as never;

describe('observeChatFollowUp', () => {
  it('returns what the chat shows about its follow-up, nothing else', async () => {
    mocks.read.mockResolvedValue({
      ok: true,
      conversation: {
        id: 7,
        customerName: 'Ada',
        status: 'snoozed',
        followUp: true,
        snoozedUntil: '2026-11-25T09:00:00.000Z',
      },
    });

    await expect(observeChatFollowUp(binding, 7)).resolves.toEqual({
      status: 'snoozed',
      followUp: true,
      snoozedUntil: '2026-11-25T09:00:00.000Z',
    });
    expect(mocks.read).toHaveBeenCalledWith(binding, 7);
  });

  it('returns undefined when the chat cannot be read', async () => {
    mocks.read.mockResolvedValue({ ok: false, code: 'unavailable' });
    await expect(observeChatFollowUp(binding, 7)).resolves.toBeUndefined();
  });
});
