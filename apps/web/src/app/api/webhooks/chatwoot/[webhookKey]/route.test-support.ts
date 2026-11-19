import { NextRequest } from 'next/server';
import { POST } from './route';

export const KEY = 'synthetic-webhook-key-aaaa';
export const binding = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  accountId: 2,
  inboxId: 20,
  webhookKey: KEY,
  webhookSecret: 'synthetic-webhook-signing-secret-0001',
};

export function payload(overrides: Record<string, unknown> = {}) {
  return {
    event: 'message_created',
    id: 128,
    message_type: 'incoming',
    private: false,
    content: '  Do you have\nthe Demo Phone X?  ',
    account: { id: 2, name: 'Synthetic' },
    inbox: { id: 20 },
    conversation: { id: 21, messages: [{ id: 1 }] },
    sender: { name: ' Ada ', email: 'hidden@example.invalid' },
    ...overrides,
  };
}

export function call(
  body: unknown,
  raw = false,
  headers: Record<string, string> = {}
) {
  const text = raw ? String(body) : JSON.stringify(body);
  return POST(
    new NextRequest(`https://app.example.test/api/webhooks/chatwoot/${KEY}`, {
      method: 'POST',
      body: text,
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-signature': 'sha256=abc',
        'x-chatwoot-timestamp': '1794730000',
        ...headers,
      },
    }),
    { params: Promise.resolve({ webhookKey: KEY }) }
  );
}
