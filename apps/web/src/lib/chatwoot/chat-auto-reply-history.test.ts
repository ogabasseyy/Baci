import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isLatestChatMessage,
  loadChatAutoReplyHistory,
} from './chat-auto-reply-history';
import {
  binding,
  conversation,
  message,
  stubFetch,
} from './merchant-inbox-client.test-support';

afterEach(() => vi.unstubAllGlobals());

const bot = { ...binding, botApiAccessToken: 'synthetic-bot-token-bbbb' };

describe('loadChatAutoReplyHistory', () => {
  it('returns earlier turns oldest first, without the message being answered', async () => {
    stubFetch((url) =>
      url.pathname.endsWith('/messages')
        ? {
            body: {
              payload: [
                message(1, { content: 'hi' }),
                message(2, {
                  content: 'hello!',
                  message_type: 1,
                  sender: { type: 'agent_bot' },
                }),
                message(4, {
                  content: 'Staff here, it costs 5',
                  message_type: 1,
                  sender: { type: 'user', name: 'Staff' },
                }),
                message(3, { content: 'price?' }),
              ],
            },
          }
        : { body: conversation(7) }
    );
    expect(await loadChatAutoReplyHistory(bot, 7, 3)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello!' },
    ]);
  });

  it('preserves the product-card context from the assistant’s prior reply', async () => {
    stubFetch((url) =>
      url.pathname.endsWith('/messages')
        ? {
            body: {
              payload: [
                message(1, { content: 'iPhone 13' }),
                message(2, {
                  content: 'iPhone 13',
                  message_type: 1,
                  content_type: 'cards',
                  sender: { type: 'agent_bot' },
                  content_attributes: { items: [{ title: 'iPhone 13' }] },
                }),
              ],
            },
          }
        : { body: conversation(7) }
    );
    expect(await loadChatAutoReplyHistory(bot, 7, 3)).toContainEqual({
      role: 'assistant',
      content: 'iPhone 13\niPhone 13',
      productCard: true,
    });
  });

  it('never presents a staff reply to the model as an assistant turn', async () => {
    stubFetch((url) =>
      url.pathname.endsWith('/messages')
        ? {
            body: {
              payload: [
                message(1, {
                  content: 'Staff wording',
                  message_type: 1,
                  sender: { type: 'user' },
                }),
              ],
            },
          }
        : { body: conversation(7) }
    );
    expect(await loadChatAutoReplyHistory(bot, 7, 9)).toEqual([]);
  });

  it('returns nothing when the history cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(() => ({ status: 500 }));
    expect(await loadChatAutoReplyHistory(bot, 7, 3)).toEqual([]);
  });
});

describe('isLatestChatMessage', () => {
  const stub = (ids: number[]) =>
    stubFetch((url) =>
      url.pathname.endsWith('/messages')
        ? { body: { payload: ids.map((id) => message(id)) } }
        : { body: conversation(7) }
    );

  it('is true when the answered message is the newest', async () => {
    stub([1, 2, 3]);
    expect(await isLatestChatMessage(bot, 7, 3)).toBe(true);
  });

  it('is false when the customer wrote again meanwhile', async () => {
    stub([1, 2, 3, 4]);
    expect(await isLatestChatMessage(bot, 7, 3)).toBe(false);
  });

  it('ignores the automatic email prompt after the first shopper message', async () => {
    stubFetch((url) =>
      url.pathname.endsWith('/messages')
        ? {
            body: {
              payload: [
                message(3, { content: 'How does Pay Small Small work?' }),
                message(4, {
                  message_type: 3,
                  content: 'Get notified by email',
                }),
              ],
            },
          }
        : { body: conversation(7) }
    );
    expect(await isLatestChatMessage(bot, 7, 3)).toBe(true);
  });

  it('is null when the messages cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(() => ({ status: 500 }));
    expect(await isLatestChatMessage(bot, 7, 3)).toBeNull();
  });
});
