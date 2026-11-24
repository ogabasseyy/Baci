import {
  CHAT_REPLY_ACTION_ID,
  CHAT_REPLY_NOTIFICATION_CATEGORY,
} from '@baci/shared';
import type { InvalidateQueryFilters } from '@tanstack/react-query';
import type * as NotificationsType from 'expo-notifications';
import type { Href } from 'expo-router';
import { Alert } from 'react-native';
import { NetworkError } from '@/lib/api-errors';
import { inboxConversationsKey, inboxThreadKey } from '@/lib/inbox-query-keys';
import { isDefinitelyNotSent, sendInboxReply } from '@/lib/merchant-inbox-api';
import { queryClient } from '@/lib/query-client';
import { INBOX_REPLY_MAX_LENGTH } from '@/schemas/merchant-inbox';
import {
  claimChatReply,
  firstSightThisLaunch,
  type ReplyClaim,
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

export interface ReplyDeps {
  alert: (
    title: string,
    message: string,
    buttons: { text: string; onPress?: () => void }[]
  ) => void;
  /** Whether this reply is new, a repeat of this launch, or a replay. */
  claim: (
    response: NotificationsType.NotificationResponse
  ) => Promise<ReplyClaim>;
  /** True the first time this launch sees a reply that sends nothing. */
  firstSight: (response: NotificationsType.NotificationResponse) => boolean;
  invalidate: (filters: InvalidateQueryFilters) => void;
  send: typeof sendInboxReply;
}

const defaultDeps: ReplyDeps = {
  alert: (title, message, buttons) => Alert.alert(title, message, buttons),
  claim: claimChatReply,
  firstSight: firstSightThisLaunch,
  invalidate: (filters) => {
    // Not awaited by the caller, so a rejection is caught here or it would go
    // unhandled.
    void (async () => {
      try {
        await queryClient.invalidateQueries(filters);
      } catch {
        // The chat refreshes when it opens anyway.
      }
    })();
  },
  send: sendInboxReply,
};

const STORE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGES = '/(admin)/messages' as Href;

/** The store that pushed the notification, if the push names one. */
function pushedByStore(
  response: NotificationsType.NotificationResponse
): string | null {
  const data = response.notification.request.content.data;
  const value = (data as Record<string, unknown> | null | undefined)
    ?.merchant_id;
  // Lower-cased: the server accepts either case, but the app's query keys use
  // the lower-case id, so an upper-case one would refresh the wrong cache entry.
  return typeof value === 'string' && STORE_ID.test(value)
    ? value.toLowerCase()
    : null;
}

async function sendChatReply(
  router: ReplyRouter,
  response: NotificationsType.NotificationResponse,
  deps: ReplyDeps
): Promise<void> {
  const target = getNotificationNavigationParams(response);
  const conversationId =
    target?.screen === 'message' ? Number(target.params?.id) : Number.NaN;
  const hasChat = Number.isSafeInteger(conversationId) && conversationId >= 1;
  const text = (response.userText ?? '').trim();
  const merchantId = pushedByStore(response);

  // Anything that goes to the messages list, not a chat: until the server has
  // accepted a reply, nothing proves the signed-in store is the one the
  // notification came from, and another store's chat can have the same number.
  const openMessages = {
    text: 'Open messages',
    onPress: () => router.push(MESSAGES),
  };

  // Outcomes that send nothing are shown once per launch and are never claims,
  // so they cannot later be mistaken for a reply that was sent.
  const sendsNothing = (show: () => void) => {
    if (deps.firstSight(response)) show();
  };
  if (!hasChat || !text) {
    sendsNothing(() => router.push(MESSAGES));
    return;
  }
  if (text.length > INBOX_REPLY_MAX_LENGTH) {
    sendsNothing(() =>
      deps.alert(
        'Reply too long',
        `Replies can be up to ${INBOX_REPLY_MAX_LENGTH} characters. Nothing was sent.`,
        [openMessages]
      )
    );
    return;
  }
  // Without the store, the reply could end up in another store's chat.
  if (!merchantId) {
    sendsNothing(() =>
      deps.alert(
        'Open your messages to reply',
        'This notification cannot be answered from here. Open your messages to write the reply.',
        [openMessages]
      )
    );
    return;
  }

  const claim = await deps.claim(response);
  // Handled a moment ago in this launch: the first delivery already did it.
  if (claim === 'repeat') return;
  // Handled before the app restarted: it may or may not have been sent (the
  // app may have stopped half way), so it is never sent again, and the owner is
  // told to check instead of assuming either way.
  if (claim === 'replay') {
    deps.alert(
      'Could not confirm your reply',
      'This reply was handled before the app restarted, so it may or may not have been sent. Open your messages to check before sending it again.',
      [openMessages]
    );
    return;
  }

  try {
    await deps.send(conversationId, text, merchantId);
  } catch (error) {
    if (error instanceof NetworkError && error.statusCode === 409) {
      // The signed-in store is not the one the notification was for.
      deps.alert(
        'Reply not sent',
        'This message was for another store. Switch to that store to reply. Nothing was sent.',
        [openMessages, { text: 'OK' }]
      );
    } else if (isDefinitelyNotSent(error)) {
      // The claim stays used, so the same notification can never deliver these
      // words later by itself (say, after a restart); they are shown here so
      // they can be written again.
      deps.alert('Reply not sent', `Your reply was not sent:\n\n${text}`, [
        openMessages,
        { text: 'OK' },
      ]);
    } else {
      deps.alert(
        'Could not confirm your reply',
        'The connection dropped, so it may or may not have been sent. Open your messages to check before sending it again.',
        [openMessages]
      );
    }
    return;
  }
  // The server accepted it, so it is that store's chat: refresh it and show it.
  // Best effort, each on its own: the reply is already sent, so neither may
  // read as a failure (and so lead to sending it again), and a failed refresh
  // must never stop the owner from seeing the chat.
  try {
    deps.invalidate({ queryKey: inboxThreadKey(merchantId, conversationId) });
    deps.invalidate({ queryKey: inboxConversationsKey(merchantId) });
  } catch {
    // The chat refreshes when it opens anyway.
  }
  try {
    router.push(`/(admin)/messages/${conversationId}` as Href);
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
        'Something went wrong, so your reply was not sent. Open your messages and write it again.',
        [
          { text: 'Open messages', onPress: () => router.push(MESSAGES) },
          { text: 'OK' },
        ]
      );
    } catch {
      // Nothing more can be done.
    }
  }
}
