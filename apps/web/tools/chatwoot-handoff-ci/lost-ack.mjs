import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { reconcileAmbiguousSend } from './ambiguous-send-reconciliation.mjs';
import { findSyntheticMessage } from './message-lookup.mjs';

function messagesPath(accountId, conversationId) {
  return `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
}

/**
 * Real-provider CI case: the loopback proxy waits for Chatwoot's full 2xx
 * response and drops the caller socket. A subsequent API lookup must find the
 * stored synthetic message before the harness marks the send reconciled. This
 * exercises test harness recovery logic; it is not Baci production behavior.
 */
export async function verifyLostAckMessageReconciliation({
  seed,
  api,
  upstreamBase,
}) {
  const path = messagesPath(seed.account_id, seed.conversation_id);
  const content = `Synthetic lost-ack message ${randomUUID()}`;
  const upstream = new URL(upstreamBase);
  let postCount = 0;
  let providerStatus;
  let resolveProviderOutcome;
  const providerOutcome = new Promise((resolve) => {
    resolveProviderOutcome = resolve;
  });
  const activeRequests = new Set();

  const proxy = createServer((clientRequest, clientResponse) => {
    if (clientRequest.method !== 'POST' || clientRequest.url !== path) {
      clientResponse.writeHead(404).end();
      return;
    }
    postCount += 1;
    const providerRequest = httpRequest(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        path: clientRequest.url,
        method: clientRequest.method,
        headers: {
          ...clientRequest.headers,
          host: upstream.host,
          connection: 'close',
        },
      },
      (providerResponse) => {
        providerResponse.resume();
        providerResponse.once('end', () => {
          providerStatus = providerResponse.statusCode;
          resolveProviderOutcome({ status: providerStatus });
          // The provider's complete response is withheld from the caller.
          clientResponse.destroy();
        });
      }
    );
    activeRequests.add(providerRequest);
    providerRequest.once('close', () => activeRequests.delete(providerRequest));
    providerRequest.setTimeout(8_000, () =>
      providerRequest.destroy(new Error('Chatwoot upstream request timed out'))
    );
    clientRequest.once('aborted', () =>
      providerRequest.destroy(new Error('Caller aborted the Chatwoot request'))
    );
    providerRequest.on('error', (error) => {
      resolveProviderOutcome({ error });
      clientResponse.destroy(error);
    });
    clientRequest.on('error', (error) => {
      resolveProviderOutcome({ error });
      providerRequest.destroy(error);
    });
    clientRequest.pipe(providerRequest);
  });

  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', resolve);
  });

  const address = proxy.address();
  assert.ok(address && typeof address === 'object');
  const faultBase = `http://127.0.0.1:${address.port}`;
  try {
    const post = () =>
      api(path, seed.human_token, {
        method: 'POST',
        body: { content, message_type: 'outgoing', private: false },
        base: faultBase,
      });
    const recovery = reconcileAmbiguousSend({
      send: post,
      lookup: () =>
        findSyntheticMessage({
          api,
          path,
          token: seed.human_token,
          content,
        }),
    });
    const settledRecoveryPromise = recovery.then(
      (value) => ({ value }),
      (error) => ({ error })
    );

    let timeout;
    const outcome = await Promise.race([
      providerOutcome,
      new Promise((resolve) => {
        timeout = setTimeout(
          () =>
            resolve({
              error: new Error('Timed out awaiting provider response'),
            }),
          10_000
        );
      }),
    ]);
    clearTimeout(timeout);
    assert.equal(
      outcome.error,
      undefined,
      'Chatwoot must return an API response'
    );
    assert.ok(
      outcome.status >= 200 && outcome.status < 300,
      `Expected successful Chatwoot API status, received ${outcome.status}`
    );

    const settledRecovery = await settledRecoveryPromise;
    if (settledRecovery.error) throw settledRecovery.error;
    const recovered = settledRecovery.value;
    assert.equal(
      recovered.recovered,
      true,
      'lookup hit must reconcile the ambiguous send'
    );
    assert.equal(recovered.result.content, content);
    assert.equal(postCount, 1, 'reconciled send must not be resent');
    return { providerStatus, matches: 1, postCount };
  } finally {
    for (const request of activeRequests) request.destroy();
    await new Promise((resolve, reject) =>
      proxy.close((error) => (error ? reject(error) : resolve()))
    );
  }
}
