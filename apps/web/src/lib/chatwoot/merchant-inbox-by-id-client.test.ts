import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readMerchantInboxConversationsById } from './merchant-inbox-by-id-client';
import {
  binding,
  conversation,
  stubFetch,
} from './merchant-inbox-client.test-support';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const answer = (rows: unknown[]) => ({ body: { meta: {}, payload: rows } });
const idsAsked = (init?: RequestInit): number[] =>
  JSON.parse(String(init?.body)).payload[1].values;

describe('readMerchantInboxConversationsById', () => {
  it('asks for all the chats of the bound inbox in one filter request', async () => {
    const fetchMock = stubFetch(() =>
      answer([conversation(1, 20), conversation(2, 20)])
    );

    const result = await readMerchantInboxConversationsById(binding, [1, 2]);

    expect(result.ok && [...result.conversations.keys()]).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      '/api/v1/accounts/2/conversations/filter?page=1'
    );
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { api_access_token: binding.apiAccessToken },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      payload: [
        {
          attribute_key: 'inbox_id',
          filter_operator: 'equal_to',
          values: [20],
          query_operator: 'AND',
        },
        {
          attribute_key: 'display_id',
          filter_operator: 'equal_to',
          values: [1, 2],
        },
      ],
    });
  });

  it('splits the ids so no request asks for more than a provider page', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => i + 1);
    const asked: number[][] = [];
    stubFetch((_url, init) => {
      asked.push(idsAsked(init));
      return answer(idsAsked(init).map((id) => conversation(id, 20)));
    });

    const result = await readMerchantInboxConversationsById(binding, ids);

    expect(asked.map((chunk) => chunk.length)).toEqual([25, 15]);
    expect(result.ok && result.conversations.size).toBe(40);
  });

  it('leaves out other inboxes and chats nobody asked for, whatever the engine sends', async () => {
    stubFetch(() =>
      answer([
        conversation(1, 20),
        conversation(2, 99),
        conversation(7, 20),
        { junk: true },
      ])
    );

    const result = await readMerchantInboxConversationsById(binding, [1, 2, 3]);

    expect(result.ok && [...result.conversations.keys()]).toEqual([1]);
  });

  it('makes no request when there is nothing to read', async () => {
    const fetchMock = stubFetch(() => answer([]));

    const result = await readMerchantInboxConversationsById(binding, []);

    expect(result.ok && result.conversations.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['an error status', () => ({ status: 500 })],
    ['a missing endpoint', () => ({ status: 404 })],
    ['an unexpected shape', () => ({ body: { data: {} } })],
    ['a network failure', () => new Error('down')],
  ])('reports unavailable on %s, without logging the token', async (_name, handler) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(handler);

    await expect(
      readMerchantInboxConversationsById(binding, [1])
    ).resolves.toEqual({ ok: false, code: 'unavailable' });
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      binding.apiAccessToken
    );
  });

  it('fails the whole read when one of its requests fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch((_url, init) =>
      idsAsked(init).includes(26)
        ? { status: 503 }
        : answer(idsAsked(init).map((id) => conversation(id, 20)))
    );

    await expect(
      readMerchantInboxConversationsById(
        binding,
        Array.from({ length: 30 }, (_, i) => i + 1)
      )
    ).resolves.toEqual({ ok: false, code: 'unavailable' });
  });
});
