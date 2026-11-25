import { conversation, stubFetch } from './merchant-inbox-client.test-support';

export const NOW = Date.parse('2026-11-22T10:00:00Z');

export type Call = { method: string; path: string; body: unknown };

export function recorder(
  live: Record<string, unknown> = {
    ...conversation(7),
    labels: ['handled-by-ai'],
  }
) {
  const calls: Call[] = [];
  const fetchMock = stubFetch((url, init) => {
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname.replace('/api/v1/accounts/2', ''),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return init?.method === 'POST' ? { body: {} } : { body: live };
  });
  return { calls, fetchMock };
}

export const posts = (calls: Call[]) =>
  calls.filter((c) => c.method === 'POST');

/**
 * A chat whose labels and snooze really change, with one write that can be made
 * to fail. `lostReply`: the engine applies it but the answer never arrives.
 * `readsDownAfterFailure`: the engine cannot be asked afterwards what happened.
 */
export function chatWithLabels(
  initial: string[],
  failing?: string,
  options: {
    lostReply?: boolean;
    readsDownAfterFailure?: boolean;
    /** Status of the failing write; 4xx means the engine refused it. */
    failStatus?: number;
    /** With `lostReply`: the engine stores the snooze this many seconds off. */
    snoozeDriftSeconds?: number;
    /** The chat's status before any change (default open). */
    status?: string;
  } = {}
) {
  let labels = initial;
  let snooze: { status: string; snoozed_until?: number } = {
    status: options.status ?? 'open',
  };
  let readsDown = false;
  const calls: Call[] = [];
  stubFetch((url, init) => {
    const path = url.pathname.replace('/api/v1/accounts/2', '');
    if (init?.method !== 'POST') {
      return readsDown
        ? { status: 503 }
        : { body: { ...conversation(7), labels, ...snooze } };
    }
    const body = JSON.parse(String(init.body));
    calls.push({ method: 'POST', path, body });
    if (failing && path.endsWith(failing)) {
      if (options.lostReply && path.endsWith('/toggle_status')) {
        snooze = {
          status: body.status,
          snoozed_until: body.snoozed_until + (options.snoozeDriftSeconds ?? 0),
        };
      }
      readsDown = options.readsDownAfterFailure === true;
      return { status: options.failStatus ?? 500 };
    }
    if (path.endsWith('/labels')) labels = body.labels;
    if (path.endsWith('/toggle_status')) {
      snooze = { status: body.status, snoozed_until: body.snoozed_until };
    }
    return { body: {} };
  });
  return { calls, labels: () => labels };
}
