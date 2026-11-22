import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inboxConversationsKey, inboxThreadKey } from '@/lib/inbox-query-keys';
import { updateInboxConversation } from '@/lib/merchant-inbox-api';
import type { InboxUpdate } from '@/schemas/merchant-inbox';

/**
 * Done, follow-up, priority and tags for one chat. Every change refreshes the
 * lists (the chat may move to another view) and the open thread.
 */
export function useInboxManage({
  conversationId,
  merchantId,
}: {
  conversationId: number;
  merchantId: string | undefined;
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (update: InboxUpdate) =>
      updateInboxConversation(conversationId, update),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: inboxConversationsKey(merchantId),
        }),
        queryClient.invalidateQueries({
          queryKey: inboxThreadKey(merchantId, conversationId),
        }),
      ]);
    },
  });

  return {
    update: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    hasError: mutation.isError,
    reset: mutation.reset,
  };
}
