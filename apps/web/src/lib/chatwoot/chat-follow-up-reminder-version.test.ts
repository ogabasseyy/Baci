import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readChatFollowUpReminderVersion } from './chat-follow-up-reminder-version';

const chat = {
  merchantId: 'c4a70000-0000-4000-8000-0000000000b1',
  conversationId: 7,
};

function readClient(answer: () => Promise<unknown>) {
  const byChat = vi.fn(() => ({ maybeSingle: answer }));
  const byMerchant = vi.fn(() => ({ eq: byChat }));
  const select = vi.fn(() => ({ eq: byMerchant }));
  return {
    client: { from: vi.fn(() => ({ select })) } as never,
    select,
    byMerchant,
    byChat,
  };
}

describe('readChatFollowUpReminderVersion', () => {
  it('returns the stamp of this store and chat only', async () => {
    const { client, select, byMerchant, byChat } = readClient(async () => ({
      data: { revision: 'rev-1' },
      error: null,
    }));

    await expect(readChatFollowUpReminderVersion(client, chat)).resolves.toBe(
      'rev-1'
    );
    expect(select).toHaveBeenCalledWith('revision');
    expect(byMerchant).toHaveBeenCalledWith('merchant_id', chat.merchantId);
    expect(byChat).toHaveBeenCalledWith('conversation_id', 7);
  });

  it('returns null when the chat has no reminder', async () => {
    const { client } = readClient(async () => ({ data: null, error: null }));
    await expect(
      readChatFollowUpReminderVersion(client, chat)
    ).resolves.toBeNull();
  });

  it.each([
    ['the read fails', async () => ({ data: null, error: { message: 'x' } })],
    ['the row is not as expected', async () => ({ data: {}, error: null })],
    ['the client throws', () => Promise.reject(new Error('network'))],
  ])('returns undefined when %s', async (_label, answer) => {
    const { client } = readClient(answer);
    await expect(
      readChatFollowUpReminderVersion(client, chat)
    ).resolves.toBeUndefined();
  });
});
