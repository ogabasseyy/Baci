import {
  CHAT_REPLY_ACTION_ID,
  CHAT_REPLY_NOTIFICATION_CATEGORY,
} from '@baci/shared';
import type { NotificationResponse } from 'expo-notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkError } from '@/lib/api-errors';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }));
vi.mock('@/lib/query-client', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));
vi.mock('@/lib/storage', () => {
  const store = new Map<string, string>();
  return {
    asyncStorage: {
      getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        store.set(key, value);
      },
    },
  };
});
vi.mock('@/lib/api-client', async () => {
  const errors = await import('@/lib/api-errors');
  return { apiClient: vi.fn(), NetworkError: errors.NetworkError };
});
vi.mock('./push-notifications', () => ({
  getNotificationNavigationParams: (response: NotificationResponse) => {
    const id = (
      response.notification.request.content.data as Record<string, unknown>
    )?.conversation_id;
    return typeof id === 'number'
      ? { screen: 'message', params: { id: String(id) } }
      : { screen: 'messages' };
  },
}));

import { inboxConversationsKey, inboxThreadKey } from '@/lib/inbox-query-keys';
import {
  handleChatReplyResponse,
  isChatReplyResponse,
  registerChatReplyCategory,
} from './chat-notification-reply';
import { claimChatReply } from './chat-reply-claims';

let counter = 0;
function reply(
  userText: string | undefined,
  data: Record<string, unknown> = {
    type: 'customer_message',
    conversation_id: 21,
  },
  actionIdentifier = CHAT_REPLY_ACTION_ID
): NotificationResponse {
  counter += 1;
  return {
    actionIdentifier,
    userText,
    notification: {
      date: 1_700_000_000 + counter,
      request: { identifier: `n-${counter}`, content: { data } },
    },
  } as unknown as NotificationResponse;
}

function setup() {
  const router = { push: vi.fn() };
  const deps = {
    alert: vi.fn(),
    claim: claimChatReply,
    invalidate: vi.fn(),
    send: mocks.send,
  };
  return { router, deps };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue({ id: 1 });
});

describe('registerChatReplyCategory', () => {
  it('adds a Reply action with a text box that opens the app', async () => {
    const setNotificationCategoryAsync = vi.fn().mockResolvedValue(undefined);

    await registerChatReplyCategory({
      setNotificationCategoryAsync,
    } as unknown as Parameters<typeof registerChatReplyCategory>[0]);

    expect(setNotificationCategoryAsync).toHaveBeenCalledWith(
      CHAT_REPLY_NOTIFICATION_CATEGORY,
      [
        expect.objectContaining({
          identifier: CHAT_REPLY_ACTION_ID,
          buttonTitle: 'Reply',
          textInput: expect.objectContaining({ submitButtonTitle: 'Send' }),
          options: { opensAppToForeground: true },
        }),
      ]
    );
  });
});

describe('isChatReplyResponse', () => {
  it('is true for the Reply action and false for a plain tap', () => {
    expect(isChatReplyResponse(reply('hi'))).toBe(true);
    expect(
      isChatReplyResponse(reply('hi', undefined, 'expo.default-action'))
    ).toBe(false);
  });
});

describe('handleChatReplyResponse', () => {
  it('sends the trimmed text to the chat named in the push, then opens that chat', async () => {
    const { router, deps } = setup();

    await handleChatReplyResponse(router, reply('  On its way!  '), deps);

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith(21, 'On its way!');
    expect(router.push).toHaveBeenCalledWith('/(admin)/messages/21');
    expect(deps.alert).not.toHaveBeenCalled();
  });

  it('bugfix: refreshes only the chat that was answered, plus the list', async () => {
    const { router, deps } = setup();

    await handleChatReplyResponse(router, reply('Hello'), deps);

    const filters = deps.invalidate.mock.calls.map((c) => c[0]);
    const threadFilter = filters.find((f) => 'predicate' in f);
    const listFilter = filters.find((f) => 'queryKey' in f);
    const matches = (key: readonly unknown[]) =>
      threadFilter?.predicate?.({ queryKey: key } as never) ?? false;

    // The real keys: this chat matches, another chat does not.
    expect(matches(inboxThreadKey('m', 21))).toBe(true);
    expect(matches(inboxThreadKey('m', 22))).toBe(false);
    expect(matches(inboxConversationsKey('m'))).toBe(false);
    expect(listFilter?.queryKey).toEqual([inboxConversationsKey('m')[0]]);
  });

  it('bugfix: posts a reply only once when the same response is delivered twice', async () => {
    const { router, deps } = setup();
    const response = reply('Only once please');

    await handleChatReplyResponse(router, response, deps);
    await handleChatReplyResponse(router, response, deps);

    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('opens the chat and sends nothing for an empty reply', async () => {
    const { router, deps } = setup();

    await handleChatReplyResponse(router, reply('   '), deps);

    expect(mocks.send).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/(admin)/messages/21');
  });

  it('sends nothing for a reply that is too long and says so', async () => {
    const { router, deps } = setup();

    await handleChatReplyResponse(router, reply('a'.repeat(2_001)), deps);

    expect(mocks.send).not.toHaveBeenCalled();
    expect(deps.alert).toHaveBeenCalledWith(
      'Reply too long',
      expect.stringContaining('2000'),
      expect.any(Array)
    );
  });

  it('sends nothing and shows the list when the push does not name a chat', async () => {
    const { router, deps } = setup();

    await handleChatReplyResponse(
      router,
      reply('Hello', { type: 'customer_message' }),
      deps
    );

    expect(mocks.send).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/(admin)/messages');
  });

  it('says plainly that the reply was not sent when the server refused it, and keeps the words', async () => {
    const { router, deps } = setup();
    mocks.send.mockRejectedValue(
      new NetworkError('Forbidden', { statusCode: 403 })
    );

    await handleChatReplyResponse(router, reply('Please see this'), deps);

    expect(deps.alert).toHaveBeenCalledWith(
      'Reply not sent',
      expect.stringContaining('Please see this'),
      expect.any(Array)
    );
    expect(deps.invalidate).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('bugfix: never retries or claims failure when the outcome is unknown', async () => {
    const { router, deps } = setup();
    mocks.send.mockRejectedValue(
      new NetworkError('timeout', { isTimeout: true })
    );

    await handleChatReplyResponse(router, reply('Did this go?'), deps);

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(deps.alert).toHaveBeenCalledWith(
      'Could not confirm your reply',
      expect.stringContaining('check'),
      expect.any(Array)
    );
  });

  it('bugfix: never rejects, and says nothing was sent, when something unexpected fails before sending', async () => {
    const { router, deps } = setup();
    deps.claim = vi.fn().mockRejectedValue(new Error('storage exploded'));

    await expect(
      handleChatReplyResponse(router, reply('Hello'), deps)
    ).resolves.toBeUndefined();

    expect(mocks.send).not.toHaveBeenCalled();
    expect(deps.alert).toHaveBeenCalledWith(
      'Reply not sent',
      expect.stringContaining('not sent'),
      expect.any(Array)
    );
  });

  it('bugfix: a failure after a successful send is never reported as "not sent"', async () => {
    const { router, deps } = setup();
    deps.invalidate.mockImplementation(() => {
      throw new Error('query client gone');
    });

    await expect(
      handleChatReplyResponse(router, reply('Sent fine'), deps)
    ).resolves.toBeUndefined();

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(deps.alert).not.toHaveBeenCalled();
  });
});
