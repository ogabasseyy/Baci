import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { sendMerchantInboxReply } from './merchant-inbox-client';
import {
  binding,
  CREATED,
  conversation,
  message,
  stubFetch,
} from './merchant-inbox-client.test-support';

afterEach(() => vi.unstubAllGlobals());

describe('sendMerchantInboxReply', () => {
  const reply = { conversationId: 7, content: 'Yes, it is in stock.' };

  it('posts a public outgoing message into the bound conversation', async () => {
    const fetchMock = stubFetch((_url, init) =>
      init?.method === 'POST'
        ? { body: message(45, { message_type: 1, content: reply.content }) }
        : { body: conversation(7) }
    );

    await expect(sendMerchantInboxReply(binding, reply)).resolves.toEqual({
      ok: true,
      message: {
        id: 45,
        sender: 'store',
        kind: 'text',
        text: 'Yes, it is in stock.',
        createdAt: new Date(CREATED * 1000).toISOString(),
      },
    });
    const [url, init] = fetchMock.mock.calls[1];
    expect(new URL(String(url)).pathname).toBe(
      '/api/v1/accounts/2/conversations/7/messages'
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      content: 'Yes, it is in stock.',
      message_type: 'outgoing',
      private: false,
    });
  });

  it('never posts into a conversation outside the bound inbox', async () => {
    const fetchMock = stubFetch(() => ({ body: conversation(7, 99) }));

    await expect(sendMerchantInboxReply(binding, reply)).resolves.toEqual({
      ok: false,
      code: 'not_found',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ['a network loss after submission', () => new Error('socket closed')],
    ['a provider 5xx', () => ({ status: 503 })],
    ['a provider request timeout', () => ({ status: 408 })],
    ['provider throttling', () => ({ status: 429 })],
    ['an unreadable accepted response', () => ({ body: { nope: true } })],
    [
      'an echo that is not the store reply',
      () => ({ body: message(46, { message_type: 0 }) }),
    ],
  ])('reports unknown delivery on %s without retrying', async (_l, post) => {
    const fetchMock = stubFetch((_url, init) =>
      init?.method === 'POST' ? post() : { body: conversation(7) }
    );

    await expect(sendMerchantInboxReply(binding, reply)).resolves.toEqual({
      ok: false,
      code: 'delivery_unknown',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a definite provider rejection as unavailable', async () => {
    stubFetch((_url, init) =>
      init?.method === 'POST' ? { status: 422 } : { body: conversation(7) }
    );
    await expect(sendMerchantInboxReply(binding, reply)).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });
});
