import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getMerchantInboxBinding,
  normalizeMerchantInboxApiOrigin,
} from './merchant-inbox-config';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';
const TOKEN_A = 'synthetic-agent-token-aaaa';
const TOKEN_B = 'synthetic-agent-token-bbbb';

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    EKAETTE_CHATWOOT_INBOX_ENABLED: 'true',
    EKAETTE_CHATWOOT_PLATFORM_ORIGIN: 'https://chat.example.test',
    EKAETTE_CHATWOOT_INBOX_BINDINGS: JSON.stringify([
      {
        merchantId: MERCHANT_A,
        accountId: 1,
        inboxId: 10,
        apiAccessToken: TOKEN_A,
      },
      {
        merchantId: MERCHANT_B,
        accountId: 2,
        inboxId: 20,
        apiAccessToken: TOKEN_B,
      },
    ]),
    ...overrides,
  } as unknown as NodeJS.ProcessEnv;
}

describe('getMerchantInboxBinding', () => {
  it('returns only the calling merchant binding', () => {
    expect(getMerchantInboxBinding(MERCHANT_B.toUpperCase(), env())).toEqual({
      merchantId: MERCHANT_B,
      accountId: 2,
      inboxId: 20,
      apiAccessToken: TOKEN_B,
      apiOrigin: 'https://chat.example.test',
    });
  });

  it('carries an optional reports credential and rejects a malformed one', () => {
    const withReports = (reportsApiAccessToken: unknown) =>
      env({
        EKAETTE_CHATWOOT_INBOX_BINDINGS: JSON.stringify([
          {
            merchantId: MERCHANT_A,
            accountId: 1,
            inboxId: 10,
            apiAccessToken: TOKEN_A,
            reportsApiAccessToken,
          },
        ]),
      });
    expect(
      getMerchantInboxBinding(MERCHANT_A, withReports(TOKEN_B))
        ?.reportsApiAccessToken
    ).toBe(TOKEN_B);
    expect(
      getMerchantInboxBinding(MERCHANT_A, withReports('has space'))
    ).toBeNull();
    expect(getMerchantInboxBinding(MERCHANT_A, withReports(42))).toBeNull();
  });

  it('carries an optional bot credential and rejects a malformed one', () => {
    const withBot = (botApiAccessToken: unknown) =>
      env({
        EKAETTE_CHATWOOT_INBOX_BINDINGS: JSON.stringify([
          {
            merchantId: MERCHANT_A,
            accountId: 1,
            inboxId: 10,
            apiAccessToken: TOKEN_A,
            botApiAccessToken,
          },
        ]),
      });
    expect(
      getMerchantInboxBinding(MERCHANT_A, withBot(TOKEN_B))?.botApiAccessToken
    ).toBe(TOKEN_B);
    expect(
      getMerchantInboxBinding(MERCHANT_A, withBot('has space'))
    ).toBeNull();
    expect(getMerchantInboxBinding(MERCHANT_A, withBot(7))).toBeNull();
    expect(getMerchantInboxBinding(MERCHANT_A, env())).not.toHaveProperty(
      'botApiAccessToken'
    );
  });

  it('returns null for a merchant without a binding', () => {
    expect(
      getMerchantInboxBinding('33333333-3333-4333-8333-333333333333', env())
    ).toBeNull();
  });

  it('stays off unless explicitly enabled', () => {
    expect(
      getMerchantInboxBinding(
        MERCHANT_A,
        env({ EKAETTE_CHATWOOT_INBOX_ENABLED: undefined })
      )
    ).toBeNull();
  });

  it('prefers the dedicated API origin over the public platform origin', () => {
    expect(
      getMerchantInboxBinding(
        MERCHANT_A,
        env({ EKAETTE_CHATWOOT_INBOX_API_ORIGIN: 'http://127.0.0.1:3000' })
      )?.apiOrigin
    ).toBe('http://127.0.0.1:3000');
  });

  it.each([
    ['not json', 'not-json'],
    ['not an array', '{}'],
    [
      'two merchants sharing one inbox',
      JSON.stringify([
        {
          merchantId: MERCHANT_A,
          accountId: 1,
          inboxId: 10,
          apiAccessToken: TOKEN_A,
        },
        {
          merchantId: MERCHANT_B,
          accountId: 1,
          inboxId: 10,
          apiAccessToken: TOKEN_B,
        },
      ]),
    ],
    [
      'a duplicated merchant',
      JSON.stringify([
        {
          merchantId: MERCHANT_A,
          accountId: 1,
          inboxId: 10,
          apiAccessToken: TOKEN_A,
        },
        {
          merchantId: MERCHANT_A,
          accountId: 1,
          inboxId: 11,
          apiAccessToken: TOKEN_A,
        },
      ]),
    ],
    [
      'a malformed token',
      JSON.stringify([
        {
          merchantId: MERCHANT_A,
          accountId: 1,
          inboxId: 10,
          apiAccessToken: 'x y',
        },
      ]),
    ],
    [
      'a non-numeric inbox',
      JSON.stringify([
        {
          merchantId: MERCHANT_A,
          accountId: 1,
          inboxId: '10',
          apiAccessToken: TOKEN_A,
        },
      ]),
    ],
  ])('fails closed for every merchant on %s', (_label, raw) => {
    expect(
      getMerchantInboxBinding(
        MERCHANT_A,
        env({ EKAETTE_CHATWOOT_INBOX_BINDINGS: raw })
      )
    ).toBeNull();
  });
});

describe('agent credential format', () => {
  it.each([
    'abcDEF123456+/=.~token',
    'x'.repeat(256),
  ])('accepts a printable space-free token', (apiAccessToken) => {
    expect(
      getMerchantInboxBinding(
        MERCHANT_A,
        env({
          EKAETTE_CHATWOOT_INBOX_BINDINGS: JSON.stringify([
            {
              merchantId: MERCHANT_A,
              accountId: 1,
              inboxId: 10,
              apiAccessToken,
            },
          ]),
        })
      )?.apiAccessToken
    ).toBe(apiAccessToken);
  });

  it.each([
    'short',
    'has space inside token',
    'line\nbreak-in-the-token',
    'x'.repeat(257),
  ])('rejects a header-unsafe or out-of-range token', (apiAccessToken) => {
    expect(
      getMerchantInboxBinding(
        MERCHANT_A,
        env({
          EKAETTE_CHATWOOT_INBOX_BINDINGS: JSON.stringify([
            {
              merchantId: MERCHANT_A,
              accountId: 1,
              inboxId: 10,
              apiAccessToken,
            },
          ]),
        })
      )
    ).toBeNull();
  });
});

describe('normalizeMerchantInboxApiOrigin', () => {
  it.each([
    ['https://chat.example.test/', 'https://chat.example.test'],
    ['http://127.0.0.1:43119', 'http://127.0.0.1:43119'],
    ['http://localhost:3000', 'http://localhost:3000'],
  ])('accepts %s', (value, expected) => {
    expect(normalizeMerchantInboxApiOrigin(value)).toBe(expected);
  });

  it.each([
    'http://chat.example.test',
    'https://user:pass@chat.example.test',
    'https://chat.example.test/path',
    'https://chat.example.test?x=1',
    'ftp://127.0.0.1',
    '',
    undefined,
  ])('rejects %s', (value) => {
    expect(normalizeMerchantInboxApiOrigin(value)).toBeNull();
  });
});
