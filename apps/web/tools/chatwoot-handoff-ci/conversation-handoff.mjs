import { publishFollowupAfterPending } from './handback.mjs';

const HANDOFF_REPLY = 'Synthetic bot: handing this to a human operator.';
const FOLLOWUP_REPLY = 'Synthetic bot: I can help with that.';

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

async function waitForBotReply({ api, waitFor, accountId, id, token, content }) {
  await waitFor(
    async () =>
      (await api(messagesPath(accountId, id), token)).payload?.some(
        (item) =>
          item.content === content && senderKind(item.sender) === 'agentbot'
      ),
    `AgentBot message: ${content}`
  );
}

export async function verifyConversationHandoff({
  seed,
  api,
  waitFor,
  publishTriggerMarker,
  publishFollowupMarker,
  events,
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
