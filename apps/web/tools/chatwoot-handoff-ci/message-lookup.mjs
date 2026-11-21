// Chatwoot's list-messages `before` cursor endpoint returns messages in
// descending id order (newest first) with a `before=<oldest id>` cursor.
const MAX_LOOKUP_PAGES = 20;
const LOOKUP_DEADLINE_MS = 15_000;

export async function findSyntheticMessage({
  api,
  path,
  token,
  content,
  timeoutMs = LOOKUP_DEADLINE_MS,
  signal,
  onUnexpectedCandidateShape,
}) {
  const matches = [];
  let before;
  const deadline = Date.now() + timeoutMs;
  const seenCursors = new Set();

  for (let page = 0; page < MAX_LOOKUP_PAGES; page += 1) {
    if (signal?.aborted) throw signal.reason ?? new Error('Lookup aborted');
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0)
      throw new Error('Chatwoot message lookup exceeded its time limit');
    const url = new URL(path, 'http://chatwoot.invalid');
    if (before) url.searchParams.set('before', before);
    const timeoutSignal = AbortSignal.timeout(Math.min(remainingMs, 10_000));
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    const messages = (
      await api(`${url.pathname}${url.search}`, token, {
        signal: requestSignal,
      })
    ).payload;
    if (!Array.isArray(messages))
      throw new Error('Chatwoot message lookup returned an invalid payload');

    for (const message of messages) {
      if (message.content !== content) continue;
      const isOutgoing =
        message.message_type === 1 ||
        String(message.message_type).toLowerCase() === 'outgoing';
      const senderType = String(
        message.sender?.type ?? message.sender_type ?? ''
      )
        .trim()
        .toLowerCase();
      if (isOutgoing && senderType === 'user') {
        matches.push(message);
      } else {
        onUnexpectedCandidateShape?.({
          id: message.id,
          message_type: message.message_type,
          sender_type: message.sender?.type ?? message.sender_type ?? null,
        });
      }
    }
    if (messages.length === 0) break;

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
