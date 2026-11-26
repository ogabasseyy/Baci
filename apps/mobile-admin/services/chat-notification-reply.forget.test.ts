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
import { reply, setup } from './chat-notification-reply.test-support';

const NO_STORE = { type: 'customer_message', conversation_id: 21 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue({ id: 1 });
});

describe('bugfix: a dealt-with reply is forgotten, so a later start stays quiet', () => {
  it.each([
    ['a sent reply', 'Hello', undefined],
    ['an empty reply', '   ', undefined],
    ['a reply that is too long', 'a'.repeat(2_001), undefined],
    ['a push with no store', 'Hello', NO_STORE],
  ])('forgets the response after %s', async (_name, text, data) => {
    const { router, deps } = setup(mocks.send);
    const response = reply(text, data);

    await handleChatReplyResponse(router, response, deps);

    expect(deps.forget).toHaveBeenCalledWith(response);
  });

  it('forgets the response after a send that failed', async () => {
    const { router, deps } = setup(mocks.send);
    mocks.send.mockRejectedValue(
      new NetworkError('Forbidden', { statusCode: 403 })
    );
    const response = reply('Refused');

    await handleChatReplyResponse(router, response, deps);

    expect(deps.forget).toHaveBeenCalledWith(response);
  });

  it('forgets the response after warning about a replay', async () => {
    const { router, deps } = setup(mocks.send);
    deps.claim = vi.fn().mockResolvedValue('replay');
    const response = reply('Was this sent?');

    await handleChatReplyResponse(router, response, deps);

    expect(deps.forget).toHaveBeenCalledWith(response);
  });

  it('keeps it while the first delivery is still sending, so a crash is still reported', async () => {
    const { router, deps } = setup(mocks.send);
    let finish: () => void = () => undefined;
    mocks.send.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    const response = reply('Slow network');

    const first = handleChatReplyResponse(router, response, deps);
    await handleChatReplyResponse(router, response, deps);

    expect(deps.forget).not.toHaveBeenCalled();
    finish();
    await first;
    expect(deps.forget).toHaveBeenCalledTimes(1);
  });

  it('never rejects, or reports a sent reply as not sent, when forgetting fails', async () => {
    const { router, deps } = setup(mocks.send);
    deps.forget = vi.fn().mockRejectedValue(new Error('native module gone'));

    await expect(
      handleChatReplyResponse(router, reply('Sent fine'), deps)
    ).resolves.toBeUndefined();

    expect(deps.alert).not.toHaveBeenCalled();
  });
});

describe('bugfix: every alert for a reply that may not have gone shows the words', () => {
  it.each([
    ['the push names no store', NO_STORE, undefined],
    [
      'it was for another store',
      undefined,
      new NetworkError('Conflict', { statusCode: 409 }),
    ],
    [
      'the outcome is unknown',
      undefined,
      new NetworkError('timeout', { isTimeout: true }),
    ],
  ])('when %s', async (_name, data, failure) => {
    const { router, deps } = setup(mocks.send);
    if (failure) mocks.send.mockRejectedValue(failure);

    await handleChatReplyResponse(
      router,
      reply('Delivery is on Friday', data),
      deps
    );

    expect(deps.alert.mock.calls[0][1]).toContain('Delivery is on Friday');
  });

  it.each(['replay', 'unexpected'])('after a %s', async (kind) => {
    const { router, deps } = setup(mocks.send);
    deps.claim =
      kind === 'replay'
        ? vi.fn().mockResolvedValue('replay')
        : vi.fn().mockRejectedValue(new Error('storage exploded'));

    await handleChatReplyResponse(router, reply('Friday it is'), deps);

    expect(deps.alert.mock.calls[0][1]).toContain('Friday it is');
  });

  it('when it is too long to send', async () => {
    const { router, deps } = setup(mocks.send);
    const long = 'b'.repeat(2_001);

    await handleChatReplyResponse(router, reply(long), deps);

    expect(deps.alert.mock.calls[0][1]).toContain(long);
  });
});
