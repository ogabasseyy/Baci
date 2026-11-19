import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadChatAutoReplyHistory } from './chat-auto-reply-history';
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
                message(2, { content: 'hello!', message_type: 1 }),
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

  it('returns nothing when the history cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(() => ({ status: 500 }));
    expect(await loadChatAutoReplyHistory(bot, 7, 3)).toEqual([]);
  });
});
