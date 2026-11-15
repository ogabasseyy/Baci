import { vi } from 'vitest';
import type { MerchantInboxBinding } from './merchant-inbox-config';

export const binding: MerchantInboxBinding = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  accountId: 2,
  inboxId: 20,
  apiAccessToken: 'synthetic-agent-token-aaaa',
  apiOrigin: 'https://chat.example.test',
};

export const CREATED = 1_794_720_151;

export function conversation(id: number, inboxId = 20) {
  return { id, inbox_id: inboxId, status: 'open', last_activity_at: CREATED };
}

export function message(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    content: `message ${id}`,
    message_type: 0,
    created_at: CREATED,
    content_type: 'text',
    ...overrides,
  };
}

export function stubFetch(
  handler: (
    url: URL,
    init?: RequestInit
  ) => { status?: number; body?: unknown } | Error
) {
  const fetchMock = vi.fn((input: URL | string, init?: RequestInit) => {
    const result = handler(new URL(String(input)), init);
    if (result instanceof Error) return Promise.reject(result);
    const status = result.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(result.body),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
