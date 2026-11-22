export const inboxConversationsKey = (merchantId: string | undefined) =>
  ['inbox-conversations', merchantId] as const;

export const inboxThreadKey = (
  merchantId: string | undefined,
  conversationId: number
) => ['inbox-thread', merchantId, conversationId] as const;
