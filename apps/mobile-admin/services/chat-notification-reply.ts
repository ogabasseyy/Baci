import {
  CHAT_REPLY_ACTION_ID,
  CHAT_REPLY_NOTIFICATION_CATEGORY,
} from '@baci/shared';
import type * as NotificationsType from 'expo-notifications';
import type { Href } from 'expo-router';
import { Alert } from 'react-native';
import { isDefinitelyNotSent, sendInboxReply } from '@/lib/merchant-inbox-api';
import { queryClient } from '@/lib/query-client';
import { INBOX_REPLY_MAX_LENGTH } from '@/schemas/merchant-inbox';
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
  invalidate: (queryKey: readonly string[]) => void;
  send: typeof sendInboxReply;
}

const defaultDeps: ReplyDeps = {
  alert: (title, message, buttons) => Alert.alert(title, message, buttons),
  invalidate: (queryKey) => {
    void queryClient.invalidateQueries({ queryKey });
  },
  send: sendInboxReply,
};

/**
 * The same reply can arrive twice (the live listener and the "last response"
 * read at start-up), and a reply must never be posted twice, so each one is
 * handled once. Short, since only recent responses can repeat.
 */
const handled = new Set<string>();
const HANDLED_LIMIT = 50;

function firstTime(response: NotificationsType.NotificationResponse): boolean {
  const { identifier } = response.notification.request;
  const key = `${identifier}:${response.notification.date}:${response.userText ?? ''}`;
  if (handled.has(key)) return false;
  if (handled.size >= HANDLED_LIMIT) {
    const oldest = handled.values().next().value;
    if (oldest !== undefined) handled.delete(oldest);
  }
  handled.add(key);
  return true;
}

/**
 * Sends what was typed in the notification's Reply box to that chat, once,
 * then shows the chat. The server has no idempotency key, so there is no
 * automatic retry: a failure says so plainly and keeps the words on screen.
 */
export async function handleChatReplyResponse(
  router: ReplyRouter,
  response: NotificationsType.NotificationResponse,
  deps: ReplyDeps = defaultDeps
): Promise<void> {
  if (!firstTime(response)) return;

  const target = getNotificationNavigationParams(response);
  const conversationId =
    target?.screen === 'message' ? Number(target.params?.id) : Number.NaN;
  if (!Number.isSafeInteger(conversationId) || conversationId < 1) {
    // The push did not say which chat: nothing is sent.
    router.push('/(admin)/messages' as Href);
    return;
  }
  const chat = `/(admin)/messages/${conversationId}` as Href;
  const openChat = { text: 'Open chat', onPress: () => router.push(chat) };

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
  // Prefixes of the thread and list keys (see inbox-query-keys.ts).
  deps.invalidate(['inbox-thread']);
  deps.invalidate(['inbox-conversations']);
  router.push(chat);
}
