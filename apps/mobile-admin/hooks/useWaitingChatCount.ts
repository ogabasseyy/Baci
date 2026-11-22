import { useInboxConversations } from '@/hooks/useInboxConversations';

/** How many shopper chats are waiting for the store's reply (0 while loading or on error). */
export function useWaitingChatCount(): number {
  const { data } = useInboxConversations('needs_reply');
  return data?.pages.flatMap((page) => page.conversations).length ?? 0;
}
