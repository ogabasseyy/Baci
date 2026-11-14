import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyConversationHandoff } from './conversation-handoff.mjs';

export function createAgentBotWebhookServer({
  onEvent,
  onError = (error) => console.error(error),
  onReady = () => undefined,
  host = '0.0.0.0',
  port = 8787,
}) {
  const events = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/agentbot')
      return res.writeHead(404).end();

    let event;
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      event = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('Invalid JSON');
      return;
    }

    events.push(event);
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    try {
      await onEvent(event);
    } catch (error) {
      onError(error);
    }
  });

  server.listen(port, host, () => {
    Promise.resolve(onReady()).catch(onError);
  });
  return { server, events };
}

export function createSyntheticAgentBotHandler({ seed, apiCall }) {
  return async (event) => {
    if (event.event !== 'message_created' || event.message_type !== 'incoming')
      return;
    const id = event.conversation?.id;
    if (!id) return;
    const conversationPath = `/api/v1/accounts/${seed.account_id}/conversations/${id}`;
    const conversation = await apiCall(conversationPath, seed.agent_token);
    if (conversation.status !== 'pending') return;

    const wantsHuman = event.content?.toLowerCase().includes('human');
    const content = wantsHuman
      ? 'Synthetic bot: handing this to a human operator.'
      : 'Synthetic bot: I can help with that.';
    await apiCall(`${conversationPath}/messages`, seed.agent_token, {
      method: 'POST',
      body: { content, message_type: 'outgoing', private: false },
    });
    if (wantsHuman) {
      await apiCall(`${conversationPath}/toggle_status`, seed.agent_token, {
        method: 'POST',
        body: { status: 'open' },
      });
    }
  };
}

async function api(base, path, token, options = {}) {
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

async function main() {
  const base = process.env.CHATWOOT_URL;
  const seed = JSON.parse(
    await readFile('/run/chatwoot-test/seed.json', 'utf8')
  );
  let callbackError;

  const apiCall = (path, token, options = {}) =>
    api(base, path, token, options);
  const { server, events } = createAgentBotWebhookServer({
    onEvent: createSyntheticAgentBotHandler({ seed, apiCall }),
    onError: (error) => {
      callbackError = error;
    },
    onReady: () => writeFile('/run/chatwoot-test/harness-ready', 'ready'),
  });

  async function waitFor(predicate, label) {
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      if (callbackError) throw callbackError;
      if (await predicate()) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  try {
    await verifyConversationHandoff({
      seed,
      api: apiCall,
      waitFor,
      publishTriggerMarker: () =>
        writeFile('/run/chatwoot-test/harness-ready-for-trigger', 'ready'),
      publishTakeoverMarker: () =>
        writeFile('/run/chatwoot-test/harness-ready-for-takeover', 'ready'),
      publishFollowupMarker: () =>
        writeFile('/run/chatwoot-test/harness-ready-for-followup', 'ready'),
      events,
    });
    console.log(
      'PASS: incoming event → AgentBot API reply → bot_handoff → silent human takeover → human API reply → pending handback → AgentBot API reply'
    );
  } finally {
    server.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
