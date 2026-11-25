import {
  CHAT_REPLY_ACTION_ID,
  CHAT_REPLY_NOTIFICATION_CATEGORY,
} from '@baci/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  getNotificationNavigationParams: (response: {
    notification: { request: { content: { data: Record<string, unknown> } } };
  }) => {
    const id = response.notification.request.content.data?.conversation_id;
    return typeof id === 'number'
      ? { screen: 'message', params: { id: String(id) } }
      : { screen: 'messages' };
  },
}));

import {
  inboxConversationsKey,
  inboxSearchPrefix,
  inboxThreadKey,
} from '@/lib/inbox-query-keys';
import {
  handleChatReplyResponse,
  registerChatReplyCategory,
} from './chat-notification-reply';
import {
  alertButtons,
  reply,
  STORE,
  setup,
} from './chat-notification-reply.test-support';

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

// Has letters (a-f), so its upper-case form really differs.
const LETTERED_STORE = 'abcdef12-3456-4abc-8def-abcdef123456';

describe('handleChatReplyResponse: a reply that is sent', () => {
  it('sends the trimmed text to the chat and store named in the push, then opens that chat', async () => {
    const { router, deps } = setup(mocks.send);

    await handleChatReplyResponse(router, reply('  On its way!  '), deps);

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith(21, 'On its way!', STORE);
    expect(router.push).toHaveBeenCalledWith('/(admin)/messages/21');
    expect(deps.alert).not.toHaveBeenCalled();
  });

  it("bugfix: refreshes only that store's chat, list and search results, using the real keys", async () => {
    const { router, deps } = setup(mocks.send);

    await handleChatReplyResponse(router, reply('Hello'), deps);

    const filters = deps.invalidate.mock.calls.map((c) => c[0]);
    expect(filters).toContainEqual({ queryKey: inboxThreadKey(STORE, 21) });
    expect(filters).toContainEqual({ queryKey: inboxConversationsKey(STORE) });
    // Cached search results hold whole chat snapshots, so they go stale too.
    expect(filters).toContainEqual({ queryKey: inboxSearchPrefix(STORE) });
    expect(filters).toHaveLength(3);
  });

  it('bugfix: an upper-case store id in the push is sent and refreshed in lower case', async () => {
    const { router, deps } = setup(mocks.send);

    await handleChatReplyResponse(
      router,
      reply('Hi', {
        type: 'customer_message',
        conversation_id: 21,
        merchant_id: LETTERED_STORE.toUpperCase(),
      }),
      deps
    );

    expect(mocks.send).toHaveBeenCalledWith(21, 'Hi', LETTERED_STORE);
    const filters = deps.invalidate.mock.calls.map((c) => c[0]);
    expect(filters).toContainEqual({
      queryKey: inboxThreadKey(LETTERED_STORE, 21),
    });
    expect(filters).toContainEqual({
      queryKey: inboxConversationsKey(LETTERED_STORE),
    });
  });

  it('bugfix: posts a reply only once when the same response is delivered twice', async () => {
    const { router, deps } = setup(mocks.send);
    const response = reply('Only once please');

    await handleChatReplyResponse(router, response, deps);
    await handleChatReplyResponse(router, response, deps);

    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('bugfix: still opens the chat when the cache refresh fails after a successful send', async () => {
    const { router, deps } = setup(mocks.send);
    deps.invalidate.mockImplementation(() => {
      throw new Error('query client gone');
    });

    await handleChatReplyResponse(router, reply('Sent fine'), deps);

    expect(router.push).toHaveBeenCalledWith('/(admin)/messages/21');
  });

  it('bugfix: a failure after a successful send is never reported as "not sent"', async () => {
    const { router, deps } = setup(mocks.send);
    deps.invalidate.mockImplementation(() => {
      throw new Error('query client gone');
    });

    await expect(
      handleChatReplyResponse(router, reply('Sent fine'), deps)
    ).resolves.toBeUndefined();

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(deps.alert).not.toHaveBeenCalled();
  });

  it('bugfix: never rejects, and says nothing was sent, when something unexpected fails before sending', async () => {
    const { router, deps } = setup(mocks.send);
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
    // It also gives a way to the messages, like every other failure.
    const buttons = alertButtons(deps.alert);
    expect(buttons.map((b) => b.text)).toContain('Open messages');
    buttons.find((b) => b.text === 'Open messages')?.onPress?.();
    expect(router.push).toHaveBeenCalledWith('/(admin)/messages');
  });
});
