import { clearChatFollowUpReminder } from './chat-follow-up-reminder-clear';

const MERCHANT = 'c4a70000-0000-4000-8000-0000000000b1';

describe('clearChatFollowUpReminder', () => {
  function deleteClient(error: unknown = null) {
    const eqChat = vi.fn(async () => ({ error }));
    const eqMerchant = vi.fn(() => ({ eq: eqChat }));
    const del = vi.fn(() => ({ eq: eqMerchant }));
    return {
      client: { from: vi.fn(() => ({ delete: del })) } as never,
      eqMerchant,
      eqChat,
    };
  }

  it('removes only this store and chat', async () => {
    const { client, eqMerchant, eqChat } = deleteClient();
    await expect(
      clearChatFollowUpReminder(client, {
        merchantId: MERCHANT,
        conversationId: 7,
      })
    ).resolves.toBe(true);
    expect(eqMerchant).toHaveBeenCalledWith('merchant_id', MERCHANT);
    expect(eqChat).toHaveBeenCalledWith('conversation_id', 7);
  });

  it('reports a failed delete', async () => {
    const { client } = deleteClient({ message: 'down' });
    await expect(
      clearChatFollowUpReminder(client, {
        merchantId: MERCHANT,
        conversationId: 7,
      })
    ).resolves.toBe(false);
  });
});
