import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { inboxConversationsKey, inboxThreadKey } from '@/lib/inbox-query-keys';
import { updateInboxConversation } from '@/lib/merchant-inbox-api';
import type { InboxUpdate } from '@/schemas/merchant-inbox';

/**
 * Done, follow-up, priority and tags for one chat. Every change refreshes the
 * lists (the chat may move to another view) and the open thread.
 *
 * Changes run one after another: the server replaces a chat's whole label
 * list, so two overlapping tag changes could otherwise overwrite each other.
 */
export function useInboxManage({
  conversationId,
  merchantId,
}: {
  conversationId: number;
  merchantId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const tail = useRef<Promise<unknown>>(Promise.resolve());

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

  const update = (change: InboxUpdate) => {
    // A failed change never blocks the next one; its caller still sees it.
    const run = tail.current
      .catch(() => undefined)
      .then(() => mutation.mutateAsync(change));
    tail.current = run;
    return run;
  };

  return {
    update,
    isUpdating: mutation.isPending,
    hasError: mutation.isError,
    reset: mutation.reset,
  };
}
