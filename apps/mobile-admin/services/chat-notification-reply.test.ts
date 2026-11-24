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

const STORE = '11111111-1111-4111-8111-111111111111';

let counter = 0;
function reply(
  userText: string | undefined,
  data: Record<string, unknown> = {
    type: 'customer_message',
    conversation_id: 21,
    merchant_id: STORE,
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
    expect(mocks.send).toHaveBeenCalledWith(21, 'On its way!', STORE);
    expect(router.push).toHaveBeenCalledWith('/(admin)/messages/21');
    expect(deps.alert).not.toHaveBeenCalled();
  });

  it("bugfix: refreshes only that store's chat and list, using the real keys", async () => {
    const { router, deps } = setup();

    await handleChatReplyResponse(router, reply('Hello'), deps);

    const filters = deps.invalidate.mock.calls.map((c) => c[0]);
    expect(filters).toContainEqual({ queryKey: inboxThreadKey(STORE, 21) });
    expect(filters).toContainEqual({ queryKey: inboxConversationsKey(STORE) });
    expect(filters).toHaveLength(2);
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
    deps.claim = vi
      .fn()
      .mockRejectedValue(new Error('storage exploded')) as never;

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

  it('bugfix: still opens the chat when the cache refresh fails after a successful send', async () => {
    const { router, deps } = setup();
    deps.invalidate.mockImplementation(() => {
      throw new Error('query client gone');
    });

    await handleChatReplyResponse(router, reply('Sent fine'), deps);

    expect(router.push).toHaveBeenCalledWith('/(admin)/messages/21');
  });

  it('bugfix: a reply replayed after a restart is never sent again and says to check the chat', async () => {
    const { router, deps } = setup();
    deps.claim = vi.fn().mockResolvedValue('replay') as never;

    await handleChatReplyResponse(router, reply('Was this sent?'), deps);

    expect(mocks.send).not.toHaveBeenCalled();
    expect(deps.alert).toHaveBeenCalledWith(
      'Could not confirm your reply',
      expect.stringContaining('check'),
      expect.any(Array)
    );
    const buttons = deps.alert.mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    buttons.find((b) => b.text === 'Open chat')?.onPress?.();
    expect(router.push).toHaveBeenCalledWith('/(admin)/messages/21');
  });

  it('does nothing for a repeat in the same launch, since the first delivery already acted', async () => {
    const { router, deps } = setup();
    deps.claim = vi.fn().mockResolvedValue('repeat') as never;

    await handleChatReplyResponse(router, reply('Twice'), deps);

    expect(mocks.send).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('bugfix: a refused reply stays consumed, so replaying the notification never delivers it later', async () => {
    const { router, deps } = setup();
    mocks.send.mockRejectedValueOnce(
      new NetworkError('Forbidden', { statusCode: 403 })
    );
    const first = reply('Try again please');

    await handleChatReplyResponse(router, first, deps);
    // The same response read again (say after a restart, once access is back).
    await handleChatReplyResponse(router, { ...first }, deps);

    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("bugfix: never sends a reply into another store's chat", async () => {
    const { router, deps } = setup();
    mocks.send.mockRejectedValue(
      new NetworkError('Conflict', { statusCode: 409 })
    );

    await handleChatReplyResponse(router, reply('For store A'), deps);

    expect(mocks.send).toHaveBeenCalledWith(21, 'For store A', STORE);
    expect(deps.alert).toHaveBeenCalledWith(
      'Reply not sent',
      expect.stringContaining('another store'),
      expect.any(Array)
    );
    expect(deps.invalidate).not.toHaveBeenCalled();
    // It offers the list, never this store's chat with the same number.
    const buttons = deps.alert.mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    expect(buttons.map((b) => b.text)).not.toContain('Open chat');
    buttons.find((b) => b.text === 'Open messages')?.onPress?.();
    expect(router.push).toHaveBeenCalledWith('/(admin)/messages');
  });

  it('bugfix: sends nothing when the push does not say which store it came from', async () => {
    const { router, deps } = setup();

    await handleChatReplyResponse(
      router,
      reply('Which store?', { type: 'customer_message', conversation_id: 21 }),
      deps
    );

    expect(mocks.send).not.toHaveBeenCalled();
    expect(deps.alert).toHaveBeenCalledWith(
      'Open the chat to reply',
      expect.any(String),
      expect.any(Array)
    );
  });

  it('does not release the claim when the outcome is unknown, so it is never sent twice', async () => {
    const { router, deps } = setup();
    mocks.send.mockRejectedValue(
      new NetworkError('timeout', { isTimeout: true })
    );
    const first = reply('Maybe sent');

    await handleChatReplyResponse(router, first, deps);
    await handleChatReplyResponse(router, { ...first }, deps);

    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
