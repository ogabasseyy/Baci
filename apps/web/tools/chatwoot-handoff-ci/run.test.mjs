import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createAgentBotWebhookServer } from './run.mjs';

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
