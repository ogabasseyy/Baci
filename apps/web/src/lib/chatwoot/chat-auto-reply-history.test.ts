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
