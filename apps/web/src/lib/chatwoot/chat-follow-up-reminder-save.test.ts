import { saveChatFollowUpReminder } from './chat-follow-up-reminder-save';

const MERCHANT = 'c4a70000-0000-4000-8000-0000000000b1';
const input = {
  merchantId: MERCHANT,
  conversationId: 7,
  dueAt: '2026-11-25T09:00:00.000Z',
  customerName: 'Ada',
};

function insertClient(error: unknown = null) {
  const insert = vi.fn(async () => ({ error }));
  const from = vi.fn(() => ({ insert }));
  return { client: { from } as never, from, insert };
}

function updateClient(result: { data?: unknown; error?: unknown }) {
  const select = vi.fn(async () => ({ error: null, ...result }));
  const byRevision = vi.fn(() => ({ select }));
  const byChat = vi.fn(() => ({ eq: byRevision }));
  const byMerchant = vi.fn(() => ({ eq: byChat }));
  const update = vi.fn(() => ({ eq: byMerchant }));
  const from = vi.fn(() => ({ update }));
  return { client: { from } as never, update, byMerchant, byChat, byRevision };
}

describe('saveChatFollowUpReminder', () => {
  it('records a first reminder for the chat', async () => {
    const { client, from, insert } = insertClient();

    await expect(
      saveChatFollowUpReminder(client, { ...input, version: null })
    ).resolves.toBe('done');

    expect(from).toHaveBeenCalledWith('chat_follow_up_reminders');
    // Identity and delivery history belong to the database, never to a writer.
    expect(insert).toHaveBeenCalledWith({
      merchant_id: MERCHANT,
      conversation_id: 7,
      due_at: input.dueAt,
      customer_name: 'Ada',
    });
  });

  it.each([
    ['a reminder appeared meanwhile', { code: '23505' }, 'conflict'],
    ['the write is refused', { code: '42501' }, 'failed'],
  ])('reports a first reminder when %s', async (_label, error, outcome) => {
    const { client } = insertClient(error);
    await expect(
      saveChatFollowUpReminder(client, { ...input, version: null })
    ).resolves.toBe(outcome);
  });

  it('replaces only the reminder that was read', async () => {
    const { client, update, byMerchant, byChat, byRevision } = updateClient({
      data: [{ id: 'a' }],
    });

    await expect(
      saveChatFollowUpReminder(client, { ...input, version: 'rev-1' })
    ).resolves.toBe('done');

    expect(update).toHaveBeenCalledWith({
      due_at: input.dueAt,
      customer_name: 'Ada',
    });
    expect(byMerchant).toHaveBeenCalledWith('merchant_id', MERCHANT);
    expect(byChat).toHaveBeenCalledWith('conversation_id', 7);
    expect(byRevision).toHaveBeenCalledWith('revision', 'rev-1');
  });

  it.each([
    ['the reminder was written meanwhile', { data: [] }, 'conflict'],
    ['the write fails', { error: { message: 'down' } }, 'failed'],
  ])('reports a replacement when %s', async (_label, result, outcome) => {
    const { client } = updateClient(result);
    await expect(
      saveChatFollowUpReminder(client, { ...input, version: 'rev-1' })
    ).resolves.toBe(outcome);
  });
});
