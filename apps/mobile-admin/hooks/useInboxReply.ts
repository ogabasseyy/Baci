import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { inboxThreadKey } from '@/lib/inbox-query-keys';
import { isDefinitelyNotSent, sendInboxReply } from '@/lib/merchant-inbox-api';
import {
  INBOX_REPLY_MAX_LENGTH,
  type InboxMessage,
  type InboxThreadPage,
} from '@/schemas/merchant-inbox';

export type InboxReplyStatus =
  | 'idle'
  | 'sending'
  | 'failed' // the server refused it: safe to send again
  | 'unconfirmed'; // outcome unknown: check the thread before sending again

interface Options {
  conversationId: number;
  merchantId: string | undefined;
  /** Reloads the thread and returns the store messages now on the server. */
  refreshThread: () => Promise<InboxMessage[]>;
}

/**
 * Reply state machine. `sending` blocks every further send, so a double tap
 * cannot post twice; after an unknown outcome the next send first looks for
 * the same text in the refreshed thread and only posts when it is absent.
 */
export function useInboxReply({
  conversationId,
  merchantId,
  refreshThread,
}: Options) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<InboxReplyStatus>('idle');
  const [lastKnownId, setLastKnownId] = useState(0);

  const text = draft.trim();
  const canSend =
    status !== 'sending' &&
    text.length > 0 &&
    text.length <= INBOX_REPLY_MAX_LENGTH;

  const appendToThread = (message: InboxMessage) => {
    queryClient.setQueryData<InfiniteData<InboxThreadPage, number | undefined>>(
      inboxThreadKey(merchantId, conversationId),
      (data) => {
        if (!data || data.pages.length === 0) return data;
        const [first, ...rest] = data.pages;
        if (!first || first.messages.some((m) => m.id === message.id)) {
          return data;
        }
        return {
          ...data,
          pages: [
            { ...first, messages: [...first.messages, message] },
            ...rest,
          ],
        };
      }
    );
  };

  const send = async (currentLatestId: number) => {
    if (!canSend) return;
    const body = text;
    setStatus('sending');
    try {
      if (status === 'unconfirmed') {
        let messages: InboxMessage[];
        try {
          messages = await refreshThread();
        } catch {
          // Still cannot tell whether it went out: stay unconfirmed.
          setStatus('unconfirmed');
          return;
        }
        const delivered = messages.some(
          (m) =>
            m.sender === 'store' && m.id > lastKnownId && m.text.trim() === body
        );
        if (delivered) {
          setDraft('');
          setStatus('idle');
          return;
        }
      } else {
        setLastKnownId(currentLatestId);
      }
      const message = await sendInboxReply(conversationId, body);
      appendToThread(message);
      setDraft('');
      setStatus('idle');
    } catch (error) {
      setStatus(isDefinitelyNotSent(error) ? 'failed' : 'unconfirmed');
    }
  };

  return { canSend, draft, send, setDraft, status };
}
