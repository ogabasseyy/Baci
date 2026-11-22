/** Prefix shared by every view, so one invalidation refreshes all of them. */
export const inboxConversationsKey = (merchantId: string | undefined) =>
  ['inbox-conversations', merchantId] as const;

export const inboxViewKey = (merchantId: string | undefined, view: string) =>
  ['inbox-conversations', merchantId, view] as const;

export const inboxSearchKey = (merchantId: string | undefined, term: string) =>
  ['inbox-search', merchantId, term] as const;

export const inboxThreadKey = (
  merchantId: string | undefined,
  conversationId: number
) => ['inbox-thread', merchantId, conversationId] as const;
