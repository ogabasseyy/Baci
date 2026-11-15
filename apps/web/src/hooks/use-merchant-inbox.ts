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

/**
 * Applies a polled page without dropping a reply this tab just sent: a store
 * message newer than everything the server returned is kept until a later
 * poll includes it.
 */
function mergePolledMessages(
  current: MerchantInboxMessage[],
  polled: MerchantInboxMessage[]
): MerchantInboxMessage[] {
  const polledIds = new Set(polled.map((message) => message.id));
  const newestPolledId = polled.reduce(
    (newest, message) => Math.max(newest, message.id),
    0
  );
  const unconfirmed = current.filter(
    (message) =>
      message.sender === 'store' &&
      message.id > newestPolledId &&
      !polledIds.has(message.id)
  );
  return unconfirmed.length === 0
    ? polled
    : [...polled, ...unconfirmed].sort(compareMerchantInboxMessages);
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

  function selectConversation(conversationId: number | null) {
    selectedIdRef.current = conversationId;
    setSelectedId(conversationId);
  }

  useEffect(() => {
    let active = true;
    let latest = 0;
    async function load() {
      // Polls can overlap: only the newest request may update the screen.
      latest += 1;
      const sequence = latest;
      const result = await fetchMerchantInboxConversations();
      if (!active || sequence !== latest) return;
      if (result.ok) {
        setConversations(result.conversations);
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
    let latest = 0;
    async function load() {
      latest += 1;
      const sequence = latest;
      const result = await fetchMerchantInboxThread(conversationId);
      if (!active || sequence !== latest) return;
      if (result.ok) {
        setMessages((current) => mergePolledMessages(current, result.messages));
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
    if (stillOpen) {
      setMessages((current) => mergeMessage(current, result.message));
    }
    return true;
  }

  return {
    conversations,
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
