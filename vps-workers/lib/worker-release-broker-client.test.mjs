import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { exchangeWorkerRelease, operateWorkerRelease, preflightWorkerRelease, stageWorkerRelease } from './worker-release-broker-client.mjs';
import { WORKER_RELEASE_BROKER_POLICY } from './worker-release-broker.mjs';

const sha = 'a'.repeat(40);
const token = 'not-a-real-token';
const bytes = Buffer.from('bounded release fixture');
const digest = createHash('sha256').update(bytes).digest('hex');

function archiveFetch(override = {}) {
  return async (input, options = {}) => {
    const url = String(input);
    if (url.includes('/tarball/')) {
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.authorization, `Bearer ${token}`);
      return new Response(null, { status: 302, headers: {
        location: `https://codeload.github.com/ogabasseyy/Baci/legacy.tar.gz/${sha}`,
      } });
    }
    assert.equal(url, `https://codeload.github.com/ogabasseyy/Baci/legacy.tar.gz/${sha}`);
    return new Response(bytes, { status: 200, ...override });
  };
}

async function withBroker(handler, callback) {
  const server = createServer(socket => {
    let input = '';
    socket.on('data', chunk => {
      input += chunk.toString('utf8');
      if (!input.endsWith('\n')) return;
      handler(JSON.parse(input.slice(0, -1)), socket);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await callback(server.address().port);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function withUnixBroker(handler, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'baci-broker-client-'));
  const socketPath = join(directory, 'broker.sock');
  const sockets = new Set();
  const server = createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    handler(socket);
  });
  await new Promise(resolve => server.listen(socketPath, resolve));
  try {
    await callback(socketPath);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('client sends a bounded, exact-SHA stage request and accepts only matching broker receipt', async () => {
  await withBroker((request, socket) => {
    assert.deepEqual(Object.keys(request).sort(), ['bundleSha256', 'githubToken', 'oidcToken', 'operation', 'sourceSha']);
    assert.equal(request.operation, 'stage');
    assert.equal(request.sourceSha, sha);
    assert.equal(request.bundleSha256, digest);
    assert.equal(request.githubToken, token);
    assert.equal(request.oidcToken, 'signed-oidc-token');
    socket.end(JSON.stringify({ ok: true, operation: 'stage', sourceSha: sha, entryCount: 12 }) + '\n');
  }, async port => {
    const receipt = await stageWorkerRelease({
      sha, socketPath: `127.0.0.1:${port}`, githubToken: token, oidcToken: 'signed-oidc-token',
      fetchImpl: archiveFetch(),
      exchangeImpl: (_socketPath, request) => new Promise((resolve, reject) => {
        const socket = createConnection(port, '127.0.0.1');
        let output = '';
        socket.on('data', chunk => { output += chunk.toString(); });
        socket.on('end', () => {
          try { resolve(JSON.parse(output)); } catch (error) { reject(error); }
        });
        socket.on('connect', () => socket.end(JSON.stringify(request) + '\n'));
      }),
    });
    assert.equal(receipt.entryCount, 12);
  });
});

test('client rejects invalid SHA before fetching or contacting the broker', async () => {
  let fetched = false;
  await assert.rejects(stageWorkerRelease({
    sha: 'bad', githubToken: token, oidcToken: 'oidc', fetchImpl: async () => { fetched = true; },
  }), /source SHA is invalid/);
  assert.equal(fetched, false);
});

test('preflight sends only the fixed read-only authenticated request and accepts a matching receipt', async () => {
  const receipt = await preflightWorkerRelease({
    sha,
    githubToken: token,
    oidcToken: 'signed-oidc-token',
    fetchImpl: async () => assert.fail('preflight must not download an archive'),
    exchangeImpl: async (_socketPath, request) => {
      assert.deepEqual(Object.keys(request).sort(), ['githubToken', 'oidcToken', 'operation', 'sourceSha']);
      assert.equal(request.operation, 'preflight');
      assert.equal(request.sourceSha, sha);
      return { ok: true, operation: 'preflight', sourceSha: sha, entryCount: 3 };
    },
  });
  assert.equal(receipt.entryCount, 3);
});

test('preflight rejects a receipt for another SHA', async () => {
  await assert.rejects(preflightWorkerRelease({
    sha,
    githubToken: token,
    oidcToken: 'signed-oidc-token',
    exchangeImpl: async () => ({ ok: true, operation: 'preflight', sourceSha: 'b'.repeat(40), entryCount: 1 }),
  }), /preflight/);
});

test('client sends authenticated fixed lifecycle requests and validates operation receipts', async () => {
  const readinessUnits = [
    'baci-domain-event-router.service', 'baci-event-delivery-worker.service',
    'baci-quiz-finalization.service', 'baci-gigl-tracking.service',
    'baci-gigl-tracking.timer', 'baci-cache-invalidation-drain.service',
    'baci-cache-invalidation-drain.timer',
  ];
  const readinessReceipt = await operateWorkerRelease({
    operation: 'readiness', sha, githubToken: token, oidcToken: 'signed-oidc-token',
    exchangeImpl: async (_socketPath, request) => ({
      ok: true, operation: 'readiness', sourceSha: sha, installedSha: sha, ready: true,
      units: readinessUnits, runId: '42', runAttempt: 1, jobId: '43',
    }),
  });
  assert.equal(readinessReceipt.ready, true);
  await assert.rejects(operateWorkerRelease({
    operation: 'readiness', sha, githubToken: token, oidcToken: 'signed-oidc-token',
    exchangeImpl: async () => ({
      ok: true, operation: 'readiness', sourceSha: sha, installedSha: 'b'.repeat(40), ready: true,
      units: readinessUnits, runId: '42', runAttempt: 1, jobId: '43',
    }),
  }), /readiness operation/);
  const giglReceipt = await operateWorkerRelease({
    operation: 'gigl-capability', sha, githubToken: token, oidcToken: 'signed-oidc-token',
    exchangeImpl: async (_socketPath, request) => {
      assert.deepEqual(Object.keys(request).sort(), ['githubToken', 'oidcToken', 'operation', 'sourceSha']);
      assert.equal(request.operation, 'gigl-capability');
      return {
        ok: true, operation: 'gigl-capability', sourceSha: sha,
        smokePassed: true, latched: true, scope: 'enabled',
        installedSha: sha, latchedSha: sha,
        runId: '42', runAttempt: 1, jobId: '43',
      };
    },
  });
  assert.equal(giglReceipt.smokePassed, true);
  await assert.rejects(operateWorkerRelease({
    operation: 'gigl-capability', sha, githubToken: token, oidcToken: 'signed-oidc-token',
    exchangeImpl: async () => ({
      ok: true, operation: 'gigl-capability', sourceSha: sha,
      smokePassed: true, latched: true, scope: 'enabled',
      installedSha: 'b'.repeat(40), latchedSha: 'b'.repeat(40),
      runId: '42', runAttempt: 1, jobId: '43',
    }),
  }), /gigl-capability operation/);
  for (const operation of ['promote', 'health', 'rollback']) {
    let submitted;
    const response = operation === 'rollback'
      ? { ok: true, operation, sourceSha: 'b'.repeat(40), rolledBackSha: sha, runId: '42', runAttempt: 1, jobId: '43' }
      : { ok: true, operation, sourceSha: sha, ...(operation === 'health' ? { healthy: true } : { previousSha: 'b'.repeat(40) }), runId: '42', runAttempt: 1, jobId: '43' };
    const receipt = await operateWorkerRelease({
      operation, sha, githubToken: token, oidcToken: 'signed-oidc-token',
      exchangeImpl: async (_socketPath, request) => { submitted = request; return response; },
    });
    assert.equal(submitted.operation, operation);
    assert.deepEqual(Object.keys(submitted).sort(), ['githubToken', 'oidcToken', 'operation', 'sourceSha']);
    assert.equal(receipt.operation, operation);
  }
  await assert.rejects(operateWorkerRelease({
    operation: 'promote', sha, githubToken: token, oidcToken: 'oidc',
    exchangeImpl: async () => ({ ok: true, operation: 'promote', sourceSha: 'b'.repeat(40), runId: '42', runAttempt: 1, jobId: '43' }),
  }), /promote operation/);
});

test('client rejects archive redirects outside the fixed GitHub source host', async () => {
  await assert.rejects(stageWorkerRelease({
    sha, githubToken: token, oidcToken: 'oidc',
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/archive' } }),
    exchangeImpl: async () => assert.fail('must not contact broker'),
  }), /unexpected GitHub archive redirect/);
});

test('client rejects broker receipts for another SHA or unknown operation', async () => {
  for (const response of [
    { ok: true, operation: 'stage', sourceSha: 'b'.repeat(40), entryCount: 1 },
    { ok: true, operation: 'promote', sourceSha: sha, entryCount: 1 },
    { ok: true, operation: 'stage', sourceSha: sha, entryCount: 0 },
  ]) {
    await assert.rejects(stageWorkerRelease({
      sha, githubToken: token, oidcToken: 'oidc', fetchImpl: archiveFetch(),
      exchangeImpl: async () => response,
    }), /broker rejected or mismatched/);
  }
});

test('client requests an audience-bound OIDC token and does not expose failures', async () => {
  const calls = [];
  let submitted;
  const fetchImpl = async (input, options) => {
    const url = String(input);
    calls.push({ url, options });
    if (url.includes('/tarball/')) return new Response(null, { status: 302, headers: {
      location: `https://codeload.github.com/ogabasseyy/Baci/legacy.tar.gz/${sha}`,
    } });
    if (url.startsWith('https://codeload.github.com/')) return new Response(bytes);
    return Response.json({ value: 'fresh-oidc' });
  };
  const result = await stageWorkerRelease({
    sha, githubToken: token, oidcRequestUrl: 'https://pipelines.actions.githubusercontent.com/runner/_apis/distributedtask/hubs/default/plans/plan/jobs/job/oidctoken?api-version=2.0',
    oidcRequestToken: 'request-token', fetchImpl,
    exchangeImpl: async (_path, request) => { submitted = request; return { ok: true, operation: 'stage', sourceSha: sha, entryCount: 1 }; },
  });
  assert.equal(result.sourceSha, sha);
  assert.equal(submitted.oidcToken, 'fresh-oidc');
  const oidcCall = calls.find(call => call.url.startsWith('https://pipelines.actions.githubusercontent.com/'));
  assert.equal(new URL(oidcCall.url).searchParams.get('audience'), 'https://github.com/ogabasseyy/Baci');
  assert.equal(oidcCall.options.headers.authorization, 'Bearer request-token');
});

test('client refuses untrusted or overbroad OIDC endpoints before forwarding the request token', async () => {
  for (const oidcRequestUrl of [
    'http://pipelines.actions.githubusercontent.com/runner/_apis/distributedtask/hubs/default/plans/plan/jobs/job/oidctoken?api-version=2.0',
    'https://evil.example/runner/_apis/distributedtask/hubs/default/plans/plan/jobs/job/oidctoken?api-version=2.0',
    'https://pipelines.actions.githubusercontent.com.evil.example/runner/_apis/distributedtask/hubs/default/plans/plan/jobs/job/oidctoken?api-version=2.0',
    'https://user@pipelines.actions.githubusercontent.com/runner/_apis/distributedtask/hubs/default/plans/plan/jobs/job/oidctoken?api-version=2.0',
    'https://pipelines.actions.githubusercontent.com/runner/_apis/distributedtask/other?api-version=2.0',
    'https://pipelines.actions.githubusercontent.com/runner/_apis/distributedtask/hubs/default/plans/plan/jobs/job/oidctoken?api-version=2.0&extra=x',
  ]) {
    let calls = 0;
    await assert.rejects(stageWorkerRelease({
      sha, githubToken: token, oidcRequestUrl, oidcRequestToken: 'sensitive-request-token',
      fetchImpl: async input => {
        calls += 1;
        if (String(input).includes('/tarball/')) return new Response(null, { status: 302, headers: {
          location: `https://codeload.github.com/ogabasseyy/Baci/legacy.tar.gz/${sha}`,
        } });
        if (String(input).startsWith('https://codeload.github.com/')) return new Response(bytes);
        assert.fail('untrusted OIDC endpoint was fetched');
      },
      exchangeImpl: async () => assert.fail('must not contact broker'),
    }), /OIDC endpoint is outside the trusted service/);
    assert.equal(calls, 2);
  }
});

test('socket exchange rejects trailing bytes, multiple frames, and partial replies', async () => {
  const valid = JSON.stringify({ ok: true, operation: 'stage', sourceSha: sha, entryCount: 1 });
  for (const body of [`${valid}\nextra`, `${valid}\n${valid}\n`, valid]) {
    await withUnixBroker(socket => socket.on('data', () => socket.end(body)), async socketPath => {
      await assert.rejects(exchangeWorkerRelease(socketPath, { operation: 'stage', sourceSha: sha }, { timeoutMs: 500 }), /framing is invalid/);
    });
  }
});

test('socket timeout after request transmission is marked indeterminate for safe lock retention', async () => {
  await withUnixBroker(socket => {
    // Hold the connection open to model a broker that may have committed staging.
    socket.on('data', () => {});
  }, async socketPath => {
    await assert.rejects(
      exchangeWorkerRelease(socketPath, { operation: 'stage', sourceSha: sha }, { timeoutMs: 25 }),
      error => error.message === 'broker socket timed out' && error.indeterminateBrokerOutcome === true,
    );
  });
});

test('default socket timeout exceeds fixed quiescence acquisition and cleanup bounds', () => {
  const source = readFileSync(new URL('./worker-release-broker-client.mjs', import.meta.url), 'utf8');
  assert.match(source, /timeoutMs = WORKER_RELEASE_BROKER_POLICY\.brokerClientTimeoutMs/);
  assert.match(source, /1,080s/);
  assert.match(source, /up to 630s/);
  assert.equal(WORKER_RELEASE_BROKER_POLICY.brokerClientTimeoutMs, 1_140_000);
  assert.ok(WORKER_RELEASE_BROKER_POLICY.brokerClientTimeoutMs > WORKER_RELEASE_BROKER_POLICY.brokerOperationBudgetMs);
});

test('connection refusal before request transmission is not marked indeterminate', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-broker-client-closed-'));
  const socketPath = join(directory, 'missing.sock');
  try {
    await assert.rejects(
      exchangeWorkerRelease(socketPath, { operation: 'stage', sourceSha: sha }, { timeoutMs: 500 }),
      error => error.message === 'broker socket unavailable' && error.indeterminateBrokerOutcome !== true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
