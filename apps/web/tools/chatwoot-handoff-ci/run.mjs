import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const base = process.env.CHATWOOT_URL;
const seed = JSON.parse(await readFile('/run/chatwoot-test/seed.json', 'utf8'));
const events = [];
let callbackError;

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/agentbot')
    return res.writeHead(404).end();
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const event = JSON.parse(raw);
  events.push(event);
  res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  if (event.event !== 'message_created' || event.message_type !== 'incoming')
    return;
  const id = event.conversation?.id;
  if (!id) return;
  try {
    const wantsHuman = event.content?.toLowerCase().includes('human');
    const content = wantsHuman
      ? 'Synthetic bot: handing this to a human operator.'
      : 'Synthetic bot: I can help with that.';
    await api(
      '/api/v1/accounts/' +
        seed.account_id +
        '/conversations/' +
        id +
        '/messages',
      seed.agent_token,
      {
        method: 'POST',
        body: { content, message_type: 'outgoing', private: false },
      }
    );
    if (wantsHuman) {
      await api(
        '/api/v1/accounts/' +
          seed.account_id +
          '/conversations/' +
          id +
          '/toggle_status',
        seed.agent_token,
        {
          method: 'POST',
          body: { status: 'open' },
        }
      );
    }
  } catch (error) {
    callbackError = error;
  }
});
server.listen(8787, '0.0.0.0', async () => {
  await writeFile('/run/chatwoot-test/harness-ready', 'ready');
});

async function api(path, token, options = {}) {
  const response = await fetch(base + path, {
    method: options.method ?? 'GET',
    headers: { api_access_token: token, 'content-type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `Chatwoot ${response.status} ${path}: ${text.slice(0, 300)}`
    );
  return text ? JSON.parse(text) : {};
}

async function waitFor(predicate, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (callbackError) throw callbackError;
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function messages(id) {
  return api(
    '/api/v1/accounts/' +
      seed.account_id +
      '/conversations/' +
      id +
      '/messages',
    seed.human_token
  );
}

function senderKind(sender) {
  return String(sender?.type ?? sender?.sender_type ?? '')
    .replace(/[^a-z]/gi, '')
    .toLowerCase();
}

async function waitForBotReply(id, content) {
  await waitFor(
    async () =>
      (await messages(id)).payload?.some(
        (item) =>
          item.content === content && senderKind(item.sender) === 'agentbot'
      ),
    `AgentBot message: ${content}`
  );
}

try {
  const id = seed.conversation_id;
  await waitFor(
    async () =>
      (
        await api(
          `/api/v1/accounts/${seed.account_id}/conversations/${id}`,
          seed.human_token
        )
      ).status === 'pending',
    'seeded pending conversation'
  );
  await writeFile('/run/chatwoot-test/harness-ready-for-trigger', 'ready');
  await waitForBotReply(id, 'Synthetic bot: handing this to a human operator.');
  await waitFor(async () => {
    const row = await api(
      `/api/v1/accounts/${seed.account_id}/conversations/${id}`,
      seed.human_token
    );
    return row.status === 'open' && !row.meta?.assignee;
  }, 'AgentBot handoff to the open queue');

  const human = await api(
    '/api/v1/accounts/' +
      seed.account_id +
      '/conversations/' +
      id +
      '/messages',
    seed.human_token,
    {
      method: 'POST',
      body: {
        content: 'Synthetic human operator reply.',
        message_type: 'outgoing',
        private: false,
      },
    }
  );
  if (senderKind(human.sender) !== 'user')
    throw new Error('Human reply was not attributed to User');
  await api(
    '/api/v1/accounts/' +
      seed.account_id +
      '/conversations/' +
      id +
      '/toggle_status',
    seed.human_token,
    {
      method: 'POST',
      body: { status: 'pending' },
    }
  );
  await writeFile('/run/chatwoot-test/harness-ready-for-followup', 'ready');
  await waitForBotReply(id, 'Synthetic bot: I can help with that.');
  if (!events.some((event) => event.event === 'message_created'))
    throw new Error('AgentBot webhook was not observed');
  console.log(
    'PASS: incoming event → AgentBot API reply → bot_handoff → human API reply → pending handback → AgentBot API reply'
  );
} finally {
  server.close();
}
