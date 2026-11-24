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
  getNotificationNavigationParams: (response: {
    notification: { request: { content: { data: Record<string, unknown> } } };
  }) => {
    const id = response.notification.request.content.data?.conversation_id;
    return typeof id === 'number'
      ? { screen: 'message', params: { id: String(id) } }
      : { screen: 'messages' };
  },
}));

import { handleChatReplyResponse } from './chat-notification-reply';
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

describe('handleChatReplyResponse: replies that send nothing', () => {
  it('opens the messages list and sends nothing for an empty reply', async () => {
    const { router, deps } = setup(mocks.send);

    await handleChatReplyResponse(router, reply('   '), deps);

    expect(mocks.send).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/(admin)/messages');
  });

  it('sends nothing for a reply that is too long and says so, once', async () => {
    const { router, deps } = setup(mocks.send);
    const response = reply('a'.repeat(2_001));

    await handleChatReplyResponse(router, response, deps);
    await handleChatReplyResponse(router, response, deps);

    expect(mocks.send).not.toHaveBeenCalled();
    expect(deps.alert).toHaveBeenCalledTimes(1);
    expect(deps.alert).toHaveBeenCalledWith(
      'Reply too long',
      expect.stringContaining('2000'),
      expect.any(Array)
    );
  });

  it('sends nothing and shows the list when the push does not name a chat', async () => {
    const { router, deps } = setup(mocks.send);

    await handleChatReplyResponse(
      router,
      reply('Hello', { type: 'customer_message', merchant_id: STORE }),
      deps
    );

    expect(mocks.send).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/(admin)/messages');
  });

  it('bugfix: sends nothing when the push does not say which store it came from', async () => {
    const { router, deps } = setup(mocks.send);

    await handleChatReplyResponse(
      router,
      reply('Which store?', { type: 'customer_message', conversation_id: 21 }),
      deps
    );

    expect(mocks.send).not.toHaveBeenCalled();
    expect(deps.alert).toHaveBeenCalledWith(
      'Open your messages to reply',
      expect.any(String),
      expect.any(Array)
    );
  });

  it('bugfix: these never use up a claim, so a later replay is not mislabelled', async () => {
    const { router, deps } = setup(mocks.send);
    const claim = vi.spyOn(deps, 'claim');

    await handleChatReplyResponse(router, reply('a'.repeat(2_001)), deps);
    await handleChatReplyResponse(router, reply('   '), deps);
    await handleChatReplyResponse(
      router,
      reply('No store', { type: 'customer_message', conversation_id: 21 }),
      deps
    );

    expect(claim).not.toHaveBeenCalled();
  });
});

describe('handleChatReplyResponse: replies the server did not take', () => {
  it('says plainly that the reply was not sent when the server refused it, and keeps the words', async () => {
    const { router, deps } = setup(mocks.send);
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

  it('bugfix: a refused reply stays consumed, so replaying the notification never delivers it later', async () => {
    const { router, deps } = setup(mocks.send);
    mocks.send.mockRejectedValueOnce(
      new NetworkError('Forbidden', { statusCode: 403 })
    );
    const first = reply('Try again please');

    await handleChatReplyResponse(router, first, deps);
    await handleChatReplyResponse(router, { ...first }, deps);

    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('bugfix: never retries or claims failure when the outcome is unknown', async () => {
    const { router, deps } = setup(mocks.send);
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

  it("bugfix: never sends a reply into another store's chat, and offers the list, not the chat", async () => {
    const { router, deps } = setup(mocks.send);
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
    const buttons = alertButtons(deps.alert);
    expect(buttons.map((b) => b.text)).not.toContain('Open chat');
    buttons.find((b) => b.text === 'Open messages')?.onPress?.();
    expect(router.push).toHaveBeenCalledWith('/(admin)/messages');
  });
});

describe('handleChatReplyResponse: repeats and replays', () => {
  it('bugfix: a reply replayed after a restart is never sent again and says to check', async () => {
    const { router, deps } = setup(mocks.send);
    deps.claim = vi.fn().mockResolvedValue('replay');

    await handleChatReplyResponse(router, reply('Was this sent?'), deps);

    expect(mocks.send).not.toHaveBeenCalled();
    expect(deps.alert).toHaveBeenCalledWith(
      'Could not confirm your reply',
      expect.stringContaining('check'),
      expect.any(Array)
    );
    // The list, never the chat: the signed-in store is not proven to be the
    // one the notification came from.
    const buttons = alertButtons(deps.alert);
    expect(buttons.map((b) => b.text)).toEqual(['Open messages']);
    buttons[0].onPress?.();
    expect(router.push).toHaveBeenCalledWith('/(admin)/messages');
  });

  it('does nothing for a repeat in the same launch, since the first delivery already acted', async () => {
    const { router, deps } = setup(mocks.send);
    deps.claim = vi.fn().mockResolvedValue('repeat');

    await handleChatReplyResponse(router, reply('Twice'), deps);

    expect(mocks.send).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});
