import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ version: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./chat-follow-up-reminder-version', () => ({
  readChatFollowUpReminderVersion: mocks.version,
}));

import { clearChatFollowUpReminder } from './chat-follow-up-reminder-clear';

const MERCHANT = 'c4a70000-0000-4000-8000-0000000000b1';
const chat = { merchantId: MERCHANT, conversationId: 7 };

function deleteClient(error: unknown = null) {
  const byRevision = vi.fn(async () => ({ error }));
  const byChat = vi.fn(() => ({ eq: byRevision }));
  const byMerchant = vi.fn(() => ({ eq: byChat }));
  const remove = vi.fn(() => ({ eq: byMerchant }));
  return {
    client: { from: vi.fn(() => ({ delete: remove })) } as never,
    remove,
    byMerchant,
    byChat,
    byRevision,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.version.mockResolvedValue(null);
});

describe('clearChatFollowUpReminder', () => {
  it('removes only the reminder that was read, for this store and chat', async () => {
    const { client, byMerchant, byChat, byRevision } = deleteClient();

    await expect(
      clearChatFollowUpReminder(client, { ...chat, version: 'rev-1' })
    ).resolves.toBe('done');

    expect(byMerchant).toHaveBeenCalledWith('merchant_id', MERCHANT);
    expect(byChat).toHaveBeenCalledWith('conversation_id', 7);
    expect(byRevision).toHaveBeenCalledWith('revision', 'rev-1');
  });

  it('deletes nothing when the chat had no reminder', async () => {
    const { client, remove } = deleteClient();
    await expect(
      clearChatFollowUpReminder(client, { ...chat, version: null })
    ).resolves.toBe('done');
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    ['rev-1', 'rev-2'],
    [null, 'rev-2'],
  ])('leaves a reminder written meanwhile (read %s)', async (version, left) => {
    mocks.version.mockResolvedValue(left);
    await expect(
      clearChatFollowUpReminder(deleteClient().client, { ...chat, version })
    ).resolves.toBe('conflict');
  });

  it('reports a failed delete', async () => {
    const { client } = deleteClient({ message: 'down' });
    await expect(
      clearChatFollowUpReminder(client, { ...chat, version: 'rev-1' })
    ).resolves.toBe('failed');
  });

  it('reports a result it cannot confirm', async () => {
    mocks.version.mockResolvedValue(undefined);
    await expect(
      clearChatFollowUpReminder(deleteClient().client, {
        ...chat,
        version: 'rev-1',
      })
    ).resolves.toBe('failed');
  });
});
