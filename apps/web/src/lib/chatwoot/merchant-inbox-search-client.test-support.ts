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
  /** Full conversations the engine's filter knows, by id. */
  reads?: Record<number, unknown>;
  /** The filtered read fails with this status instead of answering. */
  readStatus?: number;
};

export function stub(routes: Routes) {
  const calls: URL[] = [];
  /** Chat ids asked for, one list per filtered read. */
  const asked: number[][] = [];
  const fetchMock = stubFetch((url, init) => {
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
    if (path !== '/conversations/filter') return { status: 404 };
    const ids: number[] = JSON.parse(String(init?.body)).payload[1].values;
    asked.push(ids);
    if (routes.readStatus) return { status: routes.readStatus };
    // Like the engine: chats that are gone are simply not in the answer.
    const payload = ids.flatMap((id) => routes.reads?.[id] ?? []);
    return { body: { meta: {}, payload } };
  });
  return { calls, asked, fetchMock };
}

export const named = (id: number, name: string, inboxId = 20) => ({
  ...conversation(id, inboxId),
  meta: { sender: { name } },
});
