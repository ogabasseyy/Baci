export function message(id: number, sender = 'customer') {
  return {
    id,
    sender,
    kind: 'text',
    text: `message ${id}`,
    createdAt: '2026-11-15T06:00:00.000Z',
  };
}

export function conversation(id: number) {
  return {
    id,
    status: 'open',
    unreadCount: 0,
    customerName: `Customer ${id}`,
    lastActivityAt: null,
    lastMessage: null,
  };
}

type Mockable = { mockResolvedValue: (value: unknown) => unknown };

/** Default happy-path answers for the three inbox API calls. */
export function resetInboxApi(api: {
  fetchMerchantInboxConversations: Mockable;
  fetchMerchantInboxThread: Mockable;
  sendMerchantInboxReply: Mockable;
}) {
  api.fetchMerchantInboxConversations.mockResolvedValue({
    ok: true,
    conversations: [conversation(7), conversation(8)],
    hasMore: false,
  });
  api.fetchMerchantInboxThread.mockResolvedValue({
    ok: true,
    messages: [message(30)],
  });
  api.sendMerchantInboxReply.mockResolvedValue({
    ok: true,
    message: message(31, 'store'),
  });
}
