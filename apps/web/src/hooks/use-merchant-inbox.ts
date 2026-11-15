'use client';

import { useEffect, useRef, useState } from 'react';
import { compareMerchantInboxMessages } from '@/lib/chatwoot/merchant-inbox-projection';
import {
  fetchMerchantInboxConversations,
  fetchMerchantInboxThread,
  type MerchantInboxApiErrorCode,
  sendMerchantInboxReply,
} from '@/lib/merchant-inbox-api';
import type {
  MerchantInboxConversation,
  MerchantInboxMessage,
} from '@/schemas/merchant-inbox';

export const INBOX_LIST_POLL_MS = 15_000;
export const INBOX_THREAD_POLL_MS = 4_000;

export type MerchantInboxListState =
  | 'loading'
  | 'ready'
  | 'not_set_up'
  | 'signed_out'
  | 'forbidden'
  | 'unavailable';

export type MerchantInboxThreadState = 'idle' | 'loading' | 'ready' | 'error';

function listStateFor(code: MerchantInboxApiErrorCode): MerchantInboxListState {
  if (code === 'inbox_unavailable' || code === 'not_found') {
    return 'not_set_up';
  }
  if (code === 'unauthorized') return 'signed_out';
  if (code === 'forbidden') return 'forbidden';
  return 'unavailable';
}

function mergeMessage(
  messages: MerchantInboxMessage[],
  message: MerchantInboxMessage
): MerchantInboxMessage[] {
  return messages.some((existing) => existing.id === message.id)
    ? messages
    : [...messages, message].sort(compareMerchantInboxMessages);
}

/** How long an accepted reply is kept on screen while a poll omits it. */
const PENDING_REPLY_TTL_MS = 60_000;

type PendingReply = {
  conversationId: number;
  message: MerchantInboxMessage;
  sentAt: number;
};

/**
 * Applies a polled page without dropping a reply this tab just sent. Replies
 * accepted by the server are tracked explicitly until a poll returns them,
 * so one still missing is kept even when the poll already holds a newer
 * customer message.
 */
function mergePolledMessages(
  polled: MerchantInboxMessage[],
  pending: MerchantInboxMessage[]
): MerchantInboxMessage[] {
  const polledIds = new Set(polled.map((message) => message.id));
  const missing = pending.filter((message) => !polledIds.has(message.id));
  return missing.length === 0
    ? polled
    : [...polled, ...missing].sort(compareMerchantInboxMessages);
}

/** Polls while visible and refreshes at once when the tab is shown again. */
function startVisiblePolling(load: () => void, intervalMs: number): () => void {
  const timer = window.setInterval(() => {
    if (!document.hidden) load();
  }, intervalMs);
  const onVisibilityChange = () => {
    if (!document.hidden) load();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

/**
 * Merchant inbox state: polls the conversation list and the open thread while
 * the tab is visible. Polling is the only transport in this first release, so
 * a transient failure keeps what is already on screen instead of blanking it.
 */
export function useMerchantInbox() {
  const [conversations, setConversations] = useState<
    MerchantInboxConversation[]
  >([]);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const [listState, setListState] = useState<MerchantInboxListState>('loading');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<MerchantInboxMessage[]>([]);
  const [threadState, setThreadState] =
    useState<MerchantInboxThreadState>('idle');
  const [sendingIds, setSendingIds] = useState<number[]>([]);
  const [sendError, setSendError] = useState<MerchantInboxApiErrorCode | null>(
    null
  );
  // Synchronous guards: state read inside an async handler can be stale.
  // In-flight sends are tracked per conversation, so one slow reply neither
  // blocks nor shows as "sending" in another conversation.
  const sendInFlight = useRef(new Set<number>());
  const selectedIdRef = useRef<number | null>(null);
  const pendingReplies = useRef<PendingReply[]>([]);

  function selectConversation(conversationId: number | null) {
    selectedIdRef.current = conversationId;
    // Cleared together with the selection, so an error from the previous
    // conversation never renders in the next one.
    setSendError(null);
    setSelectedId(conversationId);
  }

  useEffect(() => {
    let active = true;
    let inFlight = false;
    async function load() {
      // One request at a time: a tick that finds a request still running is
      // skipped, so a slow response is applied instead of being discarded
      // by a newer, equally slow one.
      if (inFlight) return;
      inFlight = true;
      let result: Awaited<ReturnType<typeof fetchMerchantInboxConversations>>;
      try {
        result = await fetchMerchantInboxConversations();
      } finally {
        inFlight = false;
      }
      if (!active) return;
      if (result.ok) {
        setConversations(result.conversations);
        setHasMoreConversations(result.hasMore);
        setListState('ready');
        return;
      }
      const next = listStateFor(result.code);
      setListState((current) =>
        current === 'ready' && next === 'unavailable' ? current : next
      );
    }
    void load();
    const stop = startVisiblePolling(() => void load(), INBOX_LIST_POLL_MS);
    return () => {
      active = false;
      stop();
    };
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setMessages([]);
      setThreadState('idle');
      return;
    }
    let active = true;
    const conversationId = selectedId;
    setMessages([]);
    setThreadState('loading');
    setSendError(null);
    let inFlight = false;
    async function load() {
      // Same single-flight rule as the list; `active` still drops a response
      // that arrives after the merchant opened another conversation.
      if (inFlight) return;
      inFlight = true;
      let result: Awaited<ReturnType<typeof fetchMerchantInboxThread>>;
      try {
        result = await fetchMerchantInboxThread(conversationId);
      } finally {
        inFlight = false;
      }
      if (!active) return;
      if (result.ok) {
        const polledIds = new Set(result.messages.map((message) => message.id));
        const now = Date.now();
        // Stop tracking this conversation's replies once the server returns
        // them, and any reply after a bound. Other conversations' pending
        // replies are kept, so switching away and back cannot drop one.
        pendingReplies.current = pendingReplies.current.filter(
          (pending) =>
            now - pending.sentAt < PENDING_REPLY_TTL_MS &&
            (pending.conversationId !== conversationId ||
              !polledIds.has(pending.message.id))
        );
        setMessages(
          mergePolledMessages(
            result.messages,
            pendingReplies.current
              .filter((pending) => pending.conversationId === conversationId)
              .map((pending) => pending.message)
          )
        );
        setThreadState('ready');
        return;
      }
      setThreadState((current) => (current === 'ready' ? current : 'error'));
    }
    void load();
    const stop = startVisiblePolling(() => void load(), INBOX_THREAD_POLL_MS);
    return () => {
      active = false;
      stop();
    };
  }, [selectedId]);

  /** Resolves true when the reply was accepted, so the composer can clear. */
  async function sendReply(content: string): Promise<boolean> {
    const conversationId = selectedIdRef.current;
    const trimmed = content.trim();
    if (
      conversationId === null ||
      !trimmed ||
      sendInFlight.current.has(conversationId)
    ) {
      return false;
    }
    sendInFlight.current.add(conversationId);
    setSendingIds((current) => [...current, conversationId]);
    setSendError(null);
    const result = await sendMerchantInboxReply(conversationId, trimmed);
    sendInFlight.current.delete(conversationId);
    setSendingIds((current) => current.filter((id) => id !== conversationId));
    // The merchant may have opened another conversation while this was in
    // flight: never show this reply, or its error, in a different thread.
    const stillOpen = selectedIdRef.current === conversationId;
    if (!result.ok) {
      if (stillOpen) setSendError(result.code);
      return false;
    }
    pendingReplies.current.push({
      conversationId,
      message: result.message,
      sentAt: Date.now(),
    });
    if (stillOpen) {
      setMessages((current) => mergeMessage(current, result.message));
    }
    return true;
  }

  return {
    conversations,
    hasMoreConversations,
    listState,
    messages,
    selectConversation,
    selectedConversation:
      conversations.find((conversation) => conversation.id === selectedId) ??
      null,
    selectedId,
    sendError,
    sendReply,
    sending: selectedId !== null && sendingIds.includes(selectedId),
    threadState,
  };
}
