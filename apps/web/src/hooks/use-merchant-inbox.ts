'use client';

import { useEffect, useState } from 'react';
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
  | 'forbidden'
  | 'unavailable';

export type MerchantInboxThreadState = 'idle' | 'loading' | 'ready' | 'error';

function listStateFor(code: MerchantInboxApiErrorCode): MerchantInboxListState {
  if (code === 'inbox_unavailable') return 'not_set_up';
  if (code === 'forbidden' || code === 'unauthorized') return 'forbidden';
  return 'unavailable';
}

function mergeMessage(
  messages: MerchantInboxMessage[],
  message: MerchantInboxMessage
): MerchantInboxMessage[] {
  return messages.some((existing) => existing.id === message.id)
    ? messages
    : [...messages, message].sort((left, right) => left.id - right.id);
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
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<MerchantInboxApiErrorCode | null>(
    null
  );

  useEffect(() => {
    let active = true;
    async function load() {
      const result = await fetchMerchantInboxConversations();
      if (!active) return;
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
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, INBOX_LIST_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
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
    async function load() {
      const result = await fetchMerchantInboxThread(conversationId);
      if (!active) return;
      if (result.ok) {
        setMessages(result.messages);
        setThreadState('ready');
        return;
      }
      setThreadState((current) => (current === 'ready' ? current : 'error'));
    }
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, INBOX_THREAD_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedId]);

  /** Resolves true when the reply was accepted, so the composer can clear. */
  async function sendReply(content: string): Promise<boolean> {
    const conversationId = selectedId;
    const trimmed = content.trim();
    if (conversationId === null || !trimmed || sending) return false;
    setSending(true);
    setSendError(null);
    const result = await sendMerchantInboxReply(conversationId, trimmed);
    setSending(false);
    if (!result.ok) {
      setSendError(result.code);
      return false;
    }
    setMessages((current) => mergeMessage(current, result.message));
    return true;
  }

  return {
    conversations,
    listState,
    messages,
    selectConversation: setSelectedId,
    selectedConversation:
      conversations.find((conversation) => conversation.id === selectedId) ??
      null,
    selectedId,
    sendError,
    sendReply,
    sending,
    threadState,
  };
}
