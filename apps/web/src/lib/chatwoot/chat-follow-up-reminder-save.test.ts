import { saveChatFollowUpReminder } from './chat-follow-up-reminder-save';

const MERCHANT = 'c4a70000-0000-4000-8000-0000000000b1';

function upsertClient(error: unknown = null) {
  const upsert = vi.fn(async () => ({ error }));
  const from = vi.fn(() => ({ upsert }));
  return { client: { from } as never, from, upsert };
}

describe('saveChatFollowUpReminder', () => {
  it('writes one reminder row for the chat, replacing an earlier one', async () => {
    const { client, from, upsert } = upsertClient();

    await expect(
      saveChatFollowUpReminder(client, {
        merchantId: MERCHANT,
        conversationId: 7,
        dueAt: '2026-11-25T09:00:00.000Z',
        customerName: 'Ada',
      })
    ).resolves.toBe(true);

    expect(from).toHaveBeenCalledWith('chat_follow_up_reminders');
    const [row, options] = upsert.mock.calls[0] as unknown as [
      Record<string, unknown>,
      unknown,
    ];
    expect(row).toMatchObject({
      merchant_id: MERCHANT,
      conversation_id: 7,
      due_at: '2026-11-25T09:00:00.000Z',
      customer_name: 'Ada',
      processed_at: null,
      last_listed_at: null,
    });
    expect(options).toEqual({ onConflict: 'merchant_id,conversation_id' });
  });

  it('gives a replaced reminder a new identity every time', async () => {
    const { client, upsert } = upsertClient();
    const input = {
      merchantId: MERCHANT,
      conversationId: 7,
      dueAt: '2026-11-25T09:00:00.000Z',
      customerName: '',
    };
    await saveChatFollowUpReminder(client, input);
    await saveChatFollowUpReminder(client, input);

    const ids = upsert.mock.calls.map(
      (call) => (call as unknown as [{ id: string }])[0].id
    );
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('reports a refused or failed write', async () => {
    const { client } = upsertClient({ message: 'denied' });
    await expect(
      saveChatFollowUpReminder(client, {
        merchantId: MERCHANT,
        conversationId: 7,
        dueAt: '2026-11-25T09:00:00.000Z',
        customerName: '',
      })
    ).resolves.toBe(false);
  });
});
