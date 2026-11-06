import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { verifyLostAckMessageReconciliation } from './lost-ack.mjs';

const seed = {
  account_id: 7,
  conversation_id: 12,
  human_token: 'synthetic-human-token',
};

async function startLoopbackProvider({ status = 200, resetPost = false } = {}) {
  const messages = [];
  const counts = { posts: 0, lists: 0 };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);

    if (request.method === 'POST') {
      counts.posts += 1;
      if (resetPost) {
        request.socket.destroy();
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (status >= 200 && status < 300) {
        messages.push({
          id: counts.posts,
          content: body.content,
          message_type: 1,
          sender: { type: 'user' },
        });
      }
      response
        .writeHead(status, { 'content-type': 'application/json' })
        .end(JSON.stringify({ accepted: status >= 200 && status < 300 }));
      return;
    }

    if (request.method === 'GET' && request.url.endsWith('/messages')) {
      counts.lists += 1;
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ payload: messages }));
      return;
    }
    response.writeHead(404).end();
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  return {
    base: `http://127.0.0.1:${address.port}`,
    counts,
    messages,
    async close() {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

function createApi(provider, captureFaultBase = () => undefined) {
  return async (path, _token, options = {}) => {
    const base = options.base ?? provider.base;
    if (options.base) captureFaultBase(base);
    const response = await fetch(base + path, {
      method: options.method ?? 'GET',
      headers: { 'content-type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal ?? AbortSignal.timeout(3_000),
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(`Loopback provider HTTP ${response.status}`);
    return text ? JSON.parse(text) : {};
  };
}

async function assertFaultProxyClosed(base) {
  await assert.rejects(
    fetch(`${base}/closed-check`, { signal: AbortSignal.timeout(500) }),
    /fetch failed|ECONNREFUSED/i
  );
}

test('local loopback fault proxy drops a successful response and reconciles one stored effect', async () => {
  // This local stub validates harness transport behavior only. Real Chatwoot
  // provider evidence is recorded from the pinned GitHub Actions integration.
  const provider = await startLoopbackProvider();
  let faultBase;
  try {
    const result = await verifyLostAckMessageReconciliation({
      seed,
      api: createApi(provider, (base) => {
        faultBase = base;
      }),
      upstreamBase: provider.base,
    });

    assert.equal(result.providerStatus, 200);
    assert.equal(result.matches, 1);
    assert.equal(result.postCount, 1);
    assert.equal(provider.counts.posts, 1);
    assert.equal(provider.messages.length, 1);
    assert.equal(provider.counts.lists, 1);
    await assertFaultProxyClosed(faultBase);
  } finally {
    await provider.close();
  }
});

test('non-2xx upstream response fails closed and tears down the proxy', async () => {
  const provider = await startLoopbackProvider({ status: 422 });
  let faultBase;
  try {
    await assert.rejects(
      verifyLostAckMessageReconciliation({
        seed,
        api: createApi(provider, (base) => {
          faultBase = base;
        }),
        upstreamBase: provider.base,
      }),
      /Expected successful Chatwoot API status, received 422/
    );
    assert.equal(provider.counts.posts, 1);
    assert.equal(provider.messages.length, 0);
    await assertFaultProxyClosed(faultBase);
  } finally {
    await provider.close();
  }
});

test('upstream socket failure propagates and tears down the proxy', async () => {
  const provider = await startLoopbackProvider({ resetPost: true });
  let faultBase;
  try {
    await assert.rejects(
      verifyLostAckMessageReconciliation({
        seed,
        api: createApi(provider, (base) => {
          faultBase = base;
        }),
        upstreamBase: provider.base,
      }),
      /Chatwoot must return an API response/
    );
    assert.equal(provider.counts.posts, 1);
    await assertFaultProxyClosed(faultBase);
  } finally {
    await provider.close();
  }
});
