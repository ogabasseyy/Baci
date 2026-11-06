import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import {
  createAgentBotWebhookServer,
  createSyntheticAgentBotHandler,
} from './run.mjs';

test('synthetic AgentBot stays silent while an incoming conversation is open', async () => {
  let status = 'open';
  const requests = [];
  const handler = createSyntheticAgentBotHandler({
    seed: { account_id: 7, agent_token: 'synthetic-agent-token' },
    apiCall: (path, _token, options = {}) => {
      requests.push({ path, options });
      if (path.endsWith('/conversations/12')) return { status };
      return {};
    },
  });
  const event = {
    event: 'message_created',
    message_type: 'incoming',
    content: 'Synthetic customer question.',
    conversation: { id: 12 },
  };

  await handler(event);

  assert.equal(requests.length, 1, 'open conversation should only be checked');
  assert.equal(requests[0].path, '/api/v1/accounts/7/conversations/12');

  status = 'pending';
  await handler(event);

  assert.equal(requests.length, 3);
  assert.equal(
    requests[2].path,
    '/api/v1/accounts/7/conversations/12/messages'
  );
  assert.equal(requests[2].options.body.message_type, 'outgoing');
});

test('rejects malformed webhook JSON without taking down the harness server', async () => {
  const events = [];
  const errors = [];
  const { server, events: observedEvents } = createAgentBotWebhookServer({
    host: '127.0.0.1',
    port: 0,
    onEvent: async (event) => events.push(event),
    onError: (error) => errors.push(error),
  });
  const listening = once(server, 'listening');
  await listening;

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const webhookUrl = `http://127.0.0.1:${address.port}/agentbot`;

    const malformed = await fetch(webhookUrl, {
      method: 'POST',
      body: '{not json',
    });
    assert.equal(malformed.status, 400);
    assert.equal(await malformed.text(), 'Invalid JSON');
    assert.deepEqual(observedEvents, []);

    const valid = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'message_created' }),
    });
    assert.equal(valid.status, 200);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(observedEvents, [{ event: 'message_created' }]);
    assert.deepEqual(events, [{ event: 'message_created' }]);
    assert.deepEqual(errors, []);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
