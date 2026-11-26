import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { holdUnconfirmedChatFollowUpReminder } from './chat-follow-up-reminder-hold';

const input = {
  merchantId: 'c4a70000-0000-4000-8000-0000000000b1',
  conversationId: 7,
  dueAt: '2026-11-25T09:00:00.000Z',
  customerName: 'Ada',
};

function fakeClient(errors: { remove?: unknown; upsert?: unknown } = {}) {
  const not = vi.fn(async () => ({ error: errors.remove ?? null }));
  const second = vi.fn(() => ({ not }));
  const first = vi.fn(() => ({ eq: second }));
  const remove = vi.fn(() => ({ eq: first }));
  const upsert = vi.fn(async () => ({ error: errors.upsert ?? null }));
  const from = vi.fn(() => ({ delete: remove, upsert }));
  return { client: { from } as never, from, first, second, not, upsert };
}

describe('holdUnconfirmedChatFollowUpReminder', () => {
  it('drops only a handled reminder, then records the time without replacing a pending one', async () => {
    const { client, from, first, second, not, upsert } = fakeClient();

    await expect(
      holdUnconfirmedChatFollowUpReminder(client, input)
    ).resolves.toBe(true);

    expect(from).toHaveBeenCalledWith('chat_follow_up_reminders');
    expect(first).toHaveBeenCalledWith('merchant_id', input.merchantId);
    expect(second).toHaveBeenCalledWith('conversation_id', 7);
    expect(not).toHaveBeenCalledWith('processed_at', 'is', null);
    expect(upsert).toHaveBeenCalledWith(
      {
        merchant_id: input.merchantId,
        conversation_id: 7,
        due_at: input.dueAt,
        customer_name: 'Ada',
      },
      { onConflict: 'merchant_id,conversation_id', ignoreDuplicates: true }
    );
  });

  it.each([
    ['the handled row cannot be removed', { remove: { message: 'down' } }],
    ['the write is refused', { upsert: { message: 'denied' } }],
  ])('reports failure when %s', async (_label, errors) => {
    const { client } = fakeClient(errors);
    await expect(
      holdUnconfirmedChatFollowUpReminder(client, input)
    ).resolves.toBe(false);
  });
});
