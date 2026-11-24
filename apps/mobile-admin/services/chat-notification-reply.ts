import {
  CHAT_REPLY_ACTION_ID,
  CHAT_REPLY_NOTIFICATION_CATEGORY,
} from '@baci/shared';
import type { InvalidateQueryFilters } from '@tanstack/react-query';
import type * as NotificationsType from 'expo-notifications';
import type { Href } from 'expo-router';
import { Alert } from 'react-native';
import { inboxConversationsKey, inboxThreadKey } from '@/lib/inbox-query-keys';
import { isDefinitelyNotSent, sendInboxReply } from '@/lib/merchant-inbox-api';
import { queryClient } from '@/lib/query-client';
import { INBOX_REPLY_MAX_LENGTH } from '@/schemas/merchant-inbox';
import {
  claimChatReply,
  type ReplyClaim,
  releaseChatReply,
} from './chat-reply-claims';
import { getNotificationNavigationParams } from './push-notifications';

interface ReplyRouter {
  push: (href: Href) => void;
}

/** Puts a Reply box (type, then Send) on a customer chat notification. */
export async function registerChatReplyCategory(
  notifications: typeof NotificationsType
): Promise<void> {
  await notifications.setNotificationCategoryAsync(
    CHAT_REPLY_NOTIFICATION_CATEGORY,
    [
      {
        identifier: CHAT_REPLY_ACTION_ID,
        buttonTitle: 'Reply',
        textInput: { submitButtonTitle: 'Send', placeholder: 'Write a reply…' },
        // The app opens after Send. Expo cannot run code for a closed app's
        // notification action, so without this a reply typed while the app was
        // closed would be lost without a word on iPhone.
        options: { opensAppToForeground: true },
      },
    ]
  );
}

/** True when the shop owner used the Reply box (not a plain tap). */
export function isChatReplyResponse(
  response: NotificationsType.NotificationResponse
): boolean {
  return response.actionIdentifier === CHAT_REPLY_ACTION_ID;
}

interface ReplyDeps {
  alert: (
    title: string,
    message: string,
    buttons: { text: string; onPress?: () => void }[]
  ) => void;
  /** Whether this reply is new, a repeat of this launch, or a replay. */
  claim: (
    response: NotificationsType.NotificationResponse
  ) => Promise<ReplyClaim>;
  /** Gives the claim back after a clear refusal (nothing was sent). */
  release: (response: NotificationsType.NotificationResponse) => Promise<void>;
  invalidate: (filters: InvalidateQueryFilters) => void;
  send: typeof sendInboxReply;
}

const defaultDeps: ReplyDeps = {
  alert: (title, message, buttons) => Alert.alert(title, message, buttons),
  claim: claimChatReply,
  release: releaseChatReply,
  invalidate: (filters) => {
    void queryClient.invalidateQueries(filters);
  },
  send: sendInboxReply,
};

async function sendChatReply(
  router: ReplyRouter,
  response: NotificationsType.NotificationResponse,
  deps: ReplyDeps
): Promise<void> {
  const target = getNotificationNavigationParams(response);
  const conversationId =
    target?.screen === 'message' ? Number(target.params?.id) : Number.NaN;
  const hasChat = Number.isSafeInteger(conversationId) && conversationId >= 1;
  const chat = (
    hasChat ? `/(admin)/messages/${conversationId}` : '/(admin)/messages'
  ) as Href;
  const openChat = { text: 'Open chat', onPress: () => router.push(chat) };

  const claim = await deps.claim(response);
  // Handled a moment ago in this launch: the first delivery already did it.
  if (claim === 'repeat') return;
  // Handled before the app restarted: it may or may not have been sent, so it
  // is never sent again, but the owner lands where the first delivery would
  // have and can check.
  if (claim === 'replay') {
    router.push(chat);
    return;
  }
  if (!hasChat) {
    // The push did not say which chat: nothing is sent.
    router.push(chat);
    return;
  }

  const text = (response.userText ?? '').trim();
  if (!text) {
    router.push(chat);
    return;
  }
  if (text.length > INBOX_REPLY_MAX_LENGTH) {
    deps.alert(
      'Reply too long',
      `Replies can be up to ${INBOX_REPLY_MAX_LENGTH} characters. Nothing was sent.`,
      [openChat]
    );
    return;
  }

  try {
    await deps.send(conversationId, text);
  } catch (error) {
    if (isDefinitelyNotSent(error)) {
      // Nothing was sent, so sending the same words again must work.
      await deps.release(response).catch(() => undefined);
      deps.alert('Reply not sent', `Your reply was not sent:\n\n${text}`, [
        openChat,
        { text: 'OK' },
      ]);
    } else {
      deps.alert(
        'Could not confirm your reply',
        'The connection dropped, so it may or may not have been sent. Open the chat to check before sending it again.',
        [openChat]
      );
    }
    return;
  }
  // Only the chat that changed, not every cached thread: key layout is
  // [prefix, merchantId, conversationId] (see inbox-query-keys.ts). The list
  // reorders and shows the new preview, so it refreshes.
  // Best effort, each on its own: the reply is already sent, so neither may
  // read as a failure (and so lead to sending it again), and a failed refresh
  // must never stop the owner from seeing the chat.
  try {
    const threadPrefix = inboxThreadKey(undefined, 0)[0];
    deps.invalidate({
      predicate: (query) =>
        query.queryKey[0] === threadPrefix &&
        query.queryKey[2] === conversationId,
    });
    deps.invalidate({ queryKey: [inboxConversationsKey(undefined)[0]] });
  } catch {
    // The chat refreshes when it opens anyway.
  }
  try {
    router.push(chat);
  } catch {
    // Nothing more can be done.
  }
}

/**
 * Sends what was typed in the notification's Reply box to that chat, once,
 * then shows the chat. The server has no idempotency key, so there is no
 * automatic retry: a failure says so plainly and keeps the words on screen.
 * Never rejects: it runs from a tap handler, where the owner is waiting.
 */
export async function handleChatReplyResponse(
  router: ReplyRouter,
  response: NotificationsType.NotificationResponse,
  deps: ReplyDeps = defaultDeps
): Promise<void> {
  try {
    await sendChatReply(router, response, deps);
  } catch {
    // Unexpected, and before anything was sent: failures after a successful
    // send are swallowed above, so this never claims "not sent" for a sent reply.
    try {
      deps.alert(
        'Reply not sent',
        'Something went wrong, so your reply was not sent. Open the chat and write it again.',
        [{ text: 'OK' }]
      );
    } catch {
      // Nothing more can be done.
    }
  }
}
