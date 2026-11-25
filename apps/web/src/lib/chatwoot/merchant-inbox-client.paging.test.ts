import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { listMerchantInboxMessages } from './merchant-inbox-client';
import {
  binding,
  conversation,
  message,
  stubFetch,
} from './merchant-inbox-client.test-support';
import { PROVIDER_MESSAGE_PAGE_SIZE } from './merchant-inbox-provider-limits';

afterEach(() => vi.unstubAllGlobals());

it('pins the engine page size, so changing the constant forces a re-check against the engine', () => {
  // `limit(20)` in the engine's message finder (v4.19.1). A different value
  // here means the paging rule below must be verified again.
  expect(PROVIDER_MESSAGE_PAGE_SIZE).toBe(20);
});

describe('bugfix: a short chat offered "load earlier messages"', () => {
  const pageOf = (rows: number) =>
    stubFetch((url) =>
      url.pathname.endsWith('/messages')
        ? {
            body: {
              payload: Array.from({ length: rows }, (_, i) => message(100 + i)),
            },
          }
        : { body: conversation(7) }
    );

  it('has no older page for a two-message chat', async () => {
    pageOf(2);
    await expect(
      listMerchantInboxMessages(binding, { conversationId: 7 })
    ).resolves.toMatchObject({
      ok: true,
      hasOlder: false,
      nextBefore: null,
    });
  });

  it('has no older page for a page one row short of full', async () => {
    pageOf(PROVIDER_MESSAGE_PAGE_SIZE - 1);
    await expect(
      listMerchantInboxMessages(binding, { conversationId: 7 })
    ).resolves.toMatchObject({ ok: true, hasOlder: false });
  });

  it('still offers an older page when a full page holds a row without a usable id', async () => {
    stubFetch((url) =>
      url.pathname.endsWith('/messages')
        ? {
            body: {
              payload: [
                { junk: true },
                ...Array.from(
                  { length: PROVIDER_MESSAGE_PAGE_SIZE - 1 },
                  (_, i) => message(100 + i)
                ),
              ],
            },
          }
        : { body: conversation(7) }
    );
    await expect(
      listMerchantInboxMessages(binding, { conversationId: 7 })
    ).resolves.toMatchObject({ ok: true, hasOlder: true, nextBefore: 100 });
  });

  it('ends paging when a full page has no usable id to page from', async () => {
    stubFetch((url) =>
      url.pathname.endsWith('/messages')
        ? {
            body: {
              payload: Array.from(
                { length: PROVIDER_MESSAGE_PAGE_SIZE },
                () => ({ junk: true })
              ),
            },
          }
        : { body: conversation(7) }
    );
    await expect(
      listMerchantInboxMessages(binding, { conversationId: 7 })
    ).resolves.toMatchObject({
      ok: true,
      hasOlder: false,
      nextBefore: null,
    });
  });

  it('offers an older page for a full page, with the oldest row as cursor', async () => {
    pageOf(PROVIDER_MESSAGE_PAGE_SIZE);
    await expect(
      listMerchantInboxMessages(binding, { conversationId: 7 })
    ).resolves.toMatchObject({ ok: true, hasOlder: true, nextBefore: 100 });
  });
});
