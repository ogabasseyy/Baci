import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getChatWebhookBinding } from './chat-webhook-config';

const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';
const KEY_A = 'synthetic-webhook-key-aaaa';
const KEY_B = 'synthetic-webhook-key-bbbb';
const SECRET = 'synthetic-webhook-signing-secret-0001';

function binding(overrides: Record<string, unknown> = {}) {
  return {
    merchantId: MERCHANT_A,
    accountId: 1,
    inboxId: 10,
    webhookKey: KEY_A,
    webhookSecret: SECRET,
    ...overrides,
  };
}

function env(bindings: unknown, enabled: string | undefined = 'true') {
  return {
    EKAETTE_CHATWOOT_NOTIFICATIONS_ENABLED: enabled,
    EKAETTE_CHATWOOT_WEBHOOK_BINDINGS:
      typeof bindings === 'string' ? bindings : JSON.stringify(bindings),
  } as unknown as NodeJS.ProcessEnv;
}

describe('getChatWebhookBinding', () => {
  const two = [
    binding(),
    binding({
      merchantId: MERCHANT_B.toUpperCase(),
      accountId: 2,
      inboxId: 20,
      webhookKey: KEY_B,
    }),
  ];

  it('returns only the binding selected by the endpoint key', () => {
    expect(getChatWebhookBinding(KEY_B, env(two))).toEqual({
      merchantId: MERCHANT_B,
      accountId: 2,
      inboxId: 20,
      webhookKey: KEY_B,
      webhookSecret: SECRET,
    });
  });

  it.each([
    ['an unknown key', 'synthetic-webhook-key-zzzz'],
    ['a malformed key', '../etc/passwd'],
    ['an empty key', ''],
  ])('returns null for %s', (_label, key) => {
    expect(getChatWebhookBinding(key, env(two))).toBeNull();
  });

  it('stays off unless explicitly enabled', () => {
    expect(
      getChatWebhookBinding(KEY_A, {
        EKAETTE_CHATWOOT_WEBHOOK_BINDINGS: JSON.stringify(two),
      } as unknown as NodeJS.ProcessEnv)
    ).toBeNull();
    expect(getChatWebhookBinding(KEY_A, env(two, 'false'))).toBeNull();
  });

  it.each([
    ['not json', 'not-json'],
    ['not an array', '{}'],
    [
      'a duplicated endpoint key',
      [binding(), binding({ merchantId: MERCHANT_B, inboxId: 11 })],
    ],
    [
      'two stores on one inbox',
      [binding(), binding({ merchantId: MERCHANT_B, webhookKey: KEY_B })],
    ],
    [
      'a duplicated store',
      [binding(), binding({ inboxId: 11, webhookKey: KEY_B })],
    ],
    ['a short signing secret', [binding({ webhookSecret: 'too-short' })]],
    [
      'a secret with a space',
      [binding({ webhookSecret: 'secret with a space inside 0001' })],
    ],
    ['a non-numeric inbox', [binding({ inboxId: '10' })]],
    ['a malformed store id', [binding({ merchantId: 'not-a-uuid' })]],
  ])('fails closed for every store on %s', (_label, bindings) => {
    expect(getChatWebhookBinding(KEY_A, env(bindings))).toBeNull();
  });
});
