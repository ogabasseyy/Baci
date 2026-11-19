import { describe, expect, it } from 'vitest';
import { getChatAutoReplyBinding } from './chat-auto-reply-config';

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const env = (overrides: Record<string, string | undefined> = {}, bot = true) =>
  ({
    EKAETTE_CHATWOOT_INBOX_ENABLED: 'true',
    EKAETTE_CHATWOOT_AI_REPLY_ENABLED: 'true',
    EKAETTE_CHATWOOT_PLATFORM_ORIGIN: 'https://chat.example.test',
    EKAETTE_CHATWOOT_INBOX_BINDINGS: JSON.stringify([
      {
        merchantId: MERCHANT,
        accountId: 1,
        inboxId: 10,
        apiAccessToken: 'synthetic-agent-token-aaaa',
        ...(bot ? { botApiAccessToken: 'synthetic-bot-token-bbbb' } : {}),
      },
    ]),
    ...overrides,
  }) as unknown as NodeJS.ProcessEnv;

describe('getChatAutoReplyBinding', () => {
  it('returns the binding with the bot credential when switched on', () => {
    expect(getChatAutoReplyBinding(MERCHANT, env())).toMatchObject({
      merchantId: MERCHANT,
      botApiAccessToken: 'synthetic-bot-token-bbbb',
    });
  });

  it('is off unless explicitly enabled', () => {
    expect(
      getChatAutoReplyBinding(
        MERCHANT,
        env({ EKAETTE_CHATWOOT_AI_REPLY_ENABLED: undefined })
      )
    ).toBeNull();
  });

  it('is off without a bot credential, so staff are never impersonated', () => {
    expect(getChatAutoReplyBinding(MERCHANT, env({}, false))).toBeNull();
  });

  it('is off when the inbox itself is not enabled', () => {
    expect(
      getChatAutoReplyBinding(
        MERCHANT,
        env({ EKAETTE_CHATWOOT_INBOX_ENABLED: undefined })
      )
    ).toBeNull();
  });

  it('is off for a store without a binding', () => {
    expect(
      getChatAutoReplyBinding('22222222-2222-4222-8222-222222222222', env())
    ).toBeNull();
  });
});
