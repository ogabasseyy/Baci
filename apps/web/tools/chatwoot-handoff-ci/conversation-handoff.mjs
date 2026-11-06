const HANDOFF_REPLY = 'Synthetic bot: handing this to a human operator.';
const FOLLOWUP_REPLY = 'Synthetic bot: I can help with that.';
const HUMAN_TAKEOVER_MESSAGE =
  'Synthetic customer: I have another question for the human operator.';

function conversationPath(accountId, id) {
  return `/api/v1/accounts/${accountId}/conversations/${id}`;
}

function messagesPath(accountId, id) {
  return `${conversationPath(accountId, id)}/messages`;
}

function senderKind(sender) {
  return String(sender?.type ?? sender?.sender_type ?? '')
    .replace(/[^a-z]/gi, '')
    .toLowerCase();
}

async function publishFollowupAfterPending({
  readConversation,
  publishFollowup,
}) {
  const conversation = await readConversation();
  if (conversation.status !== 'pending')
    throw new Error(
      `Expected pending handback, received ${conversation.status}`
    );
  await publishFollowup();
}

async function waitForBotReply({
  api,
  waitFor,
  accountId,
  id,
  token,
  content,
}) {
  await waitFor(
    async () =>
      (await api(messagesPath(accountId, id), token)).payload?.some(
        (item) =>
          item.content === content && senderKind(item.sender) === 'agentbot'
      ),
    `AgentBot message: ${content}`
  );
}

async function assertNoBotReplyDuringHumanTakeover({
  api,
  waitFor,
  accountId,
  id,
  token,
  events,
  publishTakeoverMarker,
  silenceWindowMs = 5000,
  pollIntervalMs = 500,
  now = () => Date.now(),
  sleep = (durationMs) =>
    new Promise((resolve) => setTimeout(resolve, durationMs)),
}) {
  const path = messagesPath(accountId, id);
  const before = await api(path, token);
  const priorMessageIds = new Set(
    (before.payload ?? []).map((message) => message.id)
  );
  const eventBaseline = events.length;
  await publishTakeoverMarker();

  await waitFor(
    async () =>
      events
        .slice(eventBaseline)
        .some(
          (event) =>
            event.event === 'message_created' &&
            event.message_type === 'incoming' &&
            event.content === HUMAN_TAKEOVER_MESSAGE &&
            String(event.conversation?.id) === String(id)
        ),
    'takeover customer message webhook'
  );

  const end = now() + silenceWindowMs;
  do {
    const conversation = await api(conversationPath(accountId, id), token);
    if (conversation.status !== 'open')
      throw new Error(
        `Expected conversation to remain open during human takeover, received ${conversation.status}`
      );
    const messages = (await api(path, token)).payload ?? [];
    const unexpectedReply = messages.find(
      (message) =>
        !priorMessageIds.has(message.id) &&
        senderKind(message.sender) === 'agentbot'
    );
    if (unexpectedReply)
      throw new Error('AgentBot replied while a human had taken over');
    if (now() >= end) break;
    await sleep(pollIntervalMs);
  } while (now() <= end);

  const conversation = await api(conversationPath(accountId, id), token);
  if (conversation.status !== 'open')
    throw new Error(
      `Expected conversation to remain open during human takeover, received ${conversation.status}`
    );
  const finalMessages = (await api(path, token)).payload ?? [];
  const lateReply = finalMessages.find(
    (message) =>
      !priorMessageIds.has(message.id) &&
      senderKind(message.sender) === 'agentbot'
  );
  if (lateReply)
    throw new Error('AgentBot replied while a human had taken over');
}

export async function verifyConversationHandoff({
  seed,
  api,
  waitFor,
  publishTriggerMarker,
  publishFollowupMarker,
  publishTakeoverMarker,
  events,
  silenceWindowMs,
  silencePollIntervalMs,
  now,
  sleep,
}) {
  const { account_id: accountId, conversation_id: id } = seed;
  const humanToken = seed.human_token;

  await waitFor(
    async () =>
      (await api(conversationPath(accountId, id), humanToken)).status ===
      'pending',
    'seeded pending conversation'
  );
  await publishTriggerMarker();
  await waitForBotReply({
    api,
    waitFor,
    accountId,
    id,
    token: humanToken,
    content: HANDOFF_REPLY,
  });
  await waitFor(async () => {
    const conversation = await api(conversationPath(accountId, id), humanToken);
    return conversation.status === 'open' && !conversation.meta?.assignee;
  }, 'AgentBot handoff to the open queue');

  await assertNoBotReplyDuringHumanTakeover({
    api,
    waitFor,
    accountId,
    id,
    token: humanToken,
    events,
    publishTakeoverMarker,
    silenceWindowMs,
    pollIntervalMs: silencePollIntervalMs,
    now,
    sleep,
  });

  const human = await api(messagesPath(accountId, id), humanToken, {
    method: 'POST',
    body: {
      content: 'Synthetic human operator reply.',
      message_type: 'outgoing',
      private: false,
    },
  });
  if (senderKind(human.sender) !== 'user')
    throw new Error('Human reply was not attributed to User');

  await api(`${conversationPath(accountId, id)}/toggle_status`, humanToken, {
    method: 'POST',
    body: { status: 'pending' },
  });
  await publishFollowupAfterPending({
    readConversation: () => api(conversationPath(accountId, id), humanToken),
    publishFollowup: publishFollowupMarker,
  });
  await waitForBotReply({
    api,
    waitFor,
    accountId,
    id,
    token: humanToken,
    content: FOLLOWUP_REPLY,
  });
  if (!events.some((event) => event.event === 'message_created'))
    throw new Error('AgentBot webhook was not observed');
}
