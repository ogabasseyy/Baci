import { useInboxConversations } from '@/hooks/useInboxConversations';

/** How many shopper chats are waiting for the store's reply (0 while loading or on error). */
export function useWaitingChatCount(): number {
  const { data } = useInboxConversations();
  return (
    data?.pages
      .flatMap((page) => page.conversations)
      .filter((conversation) => conversation.lastMessage?.sender === 'customer')
      .length ?? 0
  );
}
