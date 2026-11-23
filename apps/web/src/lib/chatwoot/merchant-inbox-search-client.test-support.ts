import { conversation, stubFetch } from './merchant-inbox-client.test-support';

/** Row of `/search/conversations` as Chatwoot v4.19.1 renders it. */
export const contactRow = (id: number, inboxId: number, name = 'Ada') => ({
  id,
  account_id: 2,
  created_at: 1_794_720_151,
  message: {},
  contact: { id: 5, name },
  inbox: { id: inboxId, name: 'Web', channel_type: 'Channel::WebWidget' },
  agent: {},
  additional_attributes: {},
});

/** Row of `/conversations/search` (models/_conversation partial). */
export const messageRow = (
  id: number,
  inboxId: number,
  messages: Array<{ content: string; message_type: number }> = []
) => ({
  id,
  uuid: `uuid-${id}`,
  created_at: 1_794_720_151,
  contact: { id: 5, name: 'Ada' },
  inbox: { id: inboxId, name: 'Web', channel_type: 'Channel::WebWidget' },
  messages: messages.map((m, i) => ({ id: i + 1, ...m, created_at: 1 })),
  account_id: 2,
});

export type Routes = {
  contact?: unknown;
  message?: unknown;
  contactStatus?: number;
  messageStatus?: number;
  /** Full conversation reads, by id. */
  reads?: Record<number, unknown>;
  /** A read that fails with this status instead of answering, by id. */
  readStatus?: Record<number, number>;
};

export function stub(routes: Routes) {
  const calls: URL[] = [];
  const fetchMock = stubFetch((url) => {
    calls.push(url);
    const path = url.pathname.replace('/api/v1/accounts/2', '');
    if (path === '/search/conversations') {
      return routes.contactStatus
        ? { status: routes.contactStatus }
        : { body: routes.contact ?? { payload: { conversations: [] } } };
    }
    if (path === '/conversations/search') {
      return routes.messageStatus
        ? { status: routes.messageStatus }
        : { body: routes.message ?? { meta: {}, payload: [] } };
    }
    const id = Number(path.split('/')[2]);
    const failing = routes.readStatus?.[id];
    if (failing) return { status: failing };
    const read = routes.reads?.[id];
    return read ? { body: read } : { status: 404 };
  });
  return { calls, fetchMock };
}

export const named = (id: number, name: string, inboxId = 20) => ({
  ...conversation(id, inboxId),
  meta: { sender: { name } },
});
