const PAGE_SIZE = 20;
const MAX_LOOKUP_PAGES = 20;
const LOOKUP_DEADLINE_MS = 15_000;

export async function findSyntheticMessage({
  api,
  path,
  token,
  content,
  timeoutMs = LOOKUP_DEADLINE_MS,
}) {
  const matches = [];
  let before;
  const deadline = Date.now() + timeoutMs;
  const seenCursors = new Set();

  for (let page = 0; page < MAX_LOOKUP_PAGES; page += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0)
      throw new Error('Chatwoot message lookup exceeded its time limit');
    const url = new URL(path, 'http://chatwoot.invalid');
    if (before) url.searchParams.set('before', before);
    const messages = (
      await api(`${url.pathname}${url.search}`, token, {
        signal: AbortSignal.timeout(Math.min(remainingMs, 10_000)),
      })
    ).payload;
    if (!Array.isArray(messages))
      throw new Error('Chatwoot message lookup returned an invalid payload');

    matches.push(
      ...messages.filter(
        (message) =>
          message.content === content &&
          (message.message_type === 1 ||
            String(message.message_type).toLowerCase() === 'outgoing') &&
          String(message.sender?.type ?? message.sender_type ?? '')
            .replace(/[^a-z]/gi, '')
            .toLowerCase() === 'user'
      )
    );
    if (messages.length < PAGE_SIZE) break;

    if (page === MAX_LOOKUP_PAGES - 1)
      throw new Error('Chatwoot message lookup reached its page limit');
    const oldestId = messages.reduce((oldest, message) =>
      Number(message.id) < Number(oldest.id) ? message : oldest
    ).id;
    const cursor = String(oldestId);
    if (!/^\d+$/.test(cursor))
      throw new Error('Chatwoot message lookup returned an invalid cursor');
    if (seenCursors.has(cursor))
      throw new Error('Chatwoot message lookup pagination did not advance');
    seenCursors.add(cursor);
    before = cursor;
  }

  return matches;
}
