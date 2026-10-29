import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { WORKER_RELEASE_BROKER_POLICY } from './worker-release-broker.mjs';

const REPOSITORY = 'ogabasseyy/Baci';
const GITHUB_API = 'https://api.github.com';
const MAX_BUNDLE_BYTES = WORKER_RELEASE_BROKER_POLICY.maxBundleBytes;
const MAX_REPLY_BYTES = 4096;
const SHA_RE = /^[0-9a-f]{40}$/;
const OPERATIONS = new Set(['stage', 'preflight', 'readiness', 'gigl-capability', 'recovery-status', 'recover', 'promote', 'health', 'rollback']);
const OIDC_ENDPOINT_ORIGIN = 'https://pipelines.actions.githubusercontent.com';

function fail(message) {
  throw new Error(`worker release broker client: ${message}`);
}

async function readArchiveDigest({ sha, githubToken, fetchImpl }) {
  const response = await fetchImpl(`${GITHUB_API}/repos/${REPOSITORY}/tarball/${sha}`, {
    redirect: 'manual',
    headers: { authorization: `Bearer ${githubToken}`, accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 302 && response.status !== 301) fail('GitHub source archive did not redirect as expected');
  const location = new URL(response.headers.get('location') ?? '');
  if (location.protocol !== 'https:' || location.hostname !== 'codeload.github.com' ||
      location.pathname !== `/ogabasseyy/Baci/legacy.tar.gz/${sha}`) fail('unexpected GitHub archive redirect');
  const archive = await fetchImpl(location, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!archive.ok || !archive.body) fail('GitHub source archive is unavailable');
  const declaredLength = Number(archive.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BUNDLE_BYTES) fail('source archive exceeds size limit');
  const reader = archive.body.getReader();
  const hash = createHash('sha256');
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BUNDLE_BYTES) {
      await reader.cancel();
      fail('source archive exceeds size limit');
    }
    hash.update(value);
  }
  if (length === 0) fail('GitHub source archive is empty');
  return hash.digest('hex');
}

async function readOidcToken({ requestUrl, requestToken, audience, fetchImpl }) {
  if (!requestUrl || !requestToken) fail('GitHub Actions OIDC request context is unavailable');
  let url;
  try { url = new URL(requestUrl); } catch { fail('GitHub Actions OIDC endpoint is invalid'); }
  const oidcPath = /^\/[A-Za-z0-9-]+\/_apis\/distributedtask\/hubs\/[^/]+\/plans\/[^/]+\/jobs\/[^/]+\/oidctoken\/?$/;
  if (url.origin !== OIDC_ENDPOINT_ORIGIN || url.username || url.password || url.hash ||
      !oidcPath.test(url.pathname) || url.searchParams.size !== 1 || url.searchParams.get('api-version') !== '2.0') {
    fail('GitHub Actions OIDC endpoint is outside the trusted service');
  }
  url.searchParams.set('audience', audience);
  const response = await fetchImpl(url, {
    redirect: 'error',
    headers: { authorization: `Bearer ${requestToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) fail('GitHub Actions OIDC token request failed');
  const payload = await response.json();
  if (typeof payload.value !== 'string' || payload.value.length < 1 || payload.value.length > 16_384) {
    fail('GitHub Actions OIDC response is invalid');
  }
  return payload.value;
}

// One broker operation is bounded at 1,080s: 360s for signed GitHub
// authorization, up to 630s for quiescence, plus fixed local cleanup margin.
// Keep the caller wait longer so it cannot time out while a fenced mutation
// is still running in the root broker.
export function exchangeWorkerRelease(socketPath, request, { timeoutMs = WORKER_RELEASE_BROKER_POLICY.brokerClientTimeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const connection = createConnection(socketPath);
    let buffer = Buffer.alloc(0);
    let settled = false;
    let requestAttempted = false;
    const timeout = setTimeout(() => finish(new Error('broker socket timed out')), timeoutMs);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      connection.destroy();
      if (error && requestAttempted) error.indeterminateBrokerOutcome = true;
      if (error) reject(error);
      else resolve(value);
    };
    connection.on('error', () => finish(new Error('broker socket unavailable')));
    connection.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_REPLY_BYTES) return finish(new Error('broker reply exceeds size limit'));
    });
    connection.on('end', () => {
      const newline = buffer.indexOf(10);
      if (newline < 0 || newline !== buffer.length - 1 || buffer.indexOf(10, newline + 1) !== -1) {
        return finish(new Error('broker reply framing is invalid'));
      }
      let payload;
      try { payload = JSON.parse(buffer.subarray(0, newline).toString('utf8')); }
      catch { return finish(new Error('broker reply is invalid')); }
      if (!validReceipt(payload, request)) {
        return finish(new Error('broker rejected or mismatched the worker release stage'));
      }
      finish(null, payload);
    });
    connection.on('close', () => {
      if (!settled) finish(new Error('broker closed before a complete reply'));
    });
    connection.on('connect', () => {
      requestAttempted = true;
      connection.end(`${JSON.stringify(request)}\n`);
    });
  });
}

function validReceipt(payload, request) {
  if (payload?.ok !== true || !OPERATIONS.has(request.operation) || payload.operation !== request.operation) return false;
  if (request.operation === 'recovery-status') {
    if (payload.sourceSha !== request.sourceSha || typeof payload.pending !== 'boolean') return false;
    if (!payload.pending) return true;
    const target = payload.recoveryOf;
    const owner = payload.recoveryOwner;
    return target && /^[1-9][0-9]{0,19}$/.test(String(target.run_id)) &&
      Number.isSafeInteger(target.run_attempt) && target.run_attempt >= 1 &&
      /^[1-9][0-9]{0,19}$/.test(String(target.job_id)) && SHA_RE.test(target.sha ?? '') &&
      owner && /^[1-9][0-9]{0,19}$/.test(String(owner.run_id)) &&
      Number.isSafeInteger(owner.run_attempt) && owner.run_attempt >= 1 &&
      /^[1-9][0-9]{0,19}$/.test(String(owner.job_id)) && SHA_RE.test(owner.sha ?? '') &&
      typeof payload.currentOwner === 'boolean' && SHA_RE.test(payload.previousSha ?? '') &&
      ['quiescing', 'health_probe', 'restore', 'recovery_required'].includes(payload.phase);
  }
  if (request.operation === 'recover') {
    return payload.sourceSha === request.sourceSha && payload.recovered === true &&
      (request.recoveryOf ? payload.rolledBackSha === request.recoveryOf.sha : SHA_RE.test(payload.rolledBackSha ?? '')) &&
      SHA_RE.test(payload.previousSha ?? '') &&
      typeof payload.alreadyRestored === 'boolean' &&
      /^[1-9][0-9]{0,19}$/.test(String(payload.runId)) && Number.isSafeInteger(payload.runAttempt) &&
      payload.runAttempt >= 1 && /^[1-9][0-9]{0,19}$/.test(String(payload.jobId));
  }
  if (request.operation === 'rollback') {
    return payload.rolledBackSha === request.sourceSha && SHA_RE.test(payload.sourceSha ?? '') &&
      /^[1-9][0-9]{0,19}$/.test(String(payload.runId)) && Number.isSafeInteger(payload.runAttempt) &&
      payload.runAttempt >= 1 && /^[1-9][0-9]{0,19}$/.test(String(payload.jobId));
  }
  if (request.operation === 'readiness') {
    const expectedUnits = [
      'baci-domain-event-router.service', 'baci-event-delivery-worker.service',
      'baci-quiz-finalization.service', 'baci-gigl-tracking.service',
      'baci-gigl-tracking.timer', 'baci-cache-invalidation-drain.service',
      'baci-cache-invalidation-drain.timer',
    ];
    return payload.sourceSha === request.sourceSha && payload.ready === true &&
      payload.installedSha === request.sourceSha && Array.isArray(payload.units) &&
      payload.units.length === expectedUnits.length && payload.units.every((unit, index) => unit === expectedUnits[index]) &&
      /^[1-9][0-9]{0,19}$/.test(String(payload.runId)) && Number.isSafeInteger(payload.runAttempt) &&
      payload.runAttempt >= 1 && /^[1-9][0-9]{0,19}$/.test(String(payload.jobId));
  }
  if (request.operation === 'gigl-capability') {
    return payload.sourceSha === request.sourceSha && payload.smokePassed === true && payload.latched === true &&
      ['enabled', 'disabled'].includes(payload.scope) && SHA_RE.test(payload.installedSha ?? '') &&
      payload.installedSha === request.sourceSha && payload.latchedSha === payload.installedSha &&
      /^[1-9][0-9]{0,19}$/.test(String(payload.runId)) && Number.isSafeInteger(payload.runAttempt) &&
      payload.runAttempt >= 1 && /^[1-9][0-9]{0,19}$/.test(String(payload.jobId));
  }
  if (payload.sourceSha !== request.sourceSha) return false;
  if (request.operation === 'stage' || request.operation === 'preflight') {
    return Number.isSafeInteger(payload.entryCount) && payload.entryCount > 0;
  }
  if (!/^[1-9][0-9]{0,19}$/.test(String(payload.runId)) || !Number.isSafeInteger(payload.runAttempt) ||
      payload.runAttempt < 1 || !/^[1-9][0-9]{0,19}$/.test(String(payload.jobId))) return false;
  return request.operation !== 'health' || payload.healthy === true;
}

/** Ask the broker to perform one fixed, authenticated release lifecycle operation. */
export async function operateWorkerRelease({
  operation,
  sha,
  recoveryOf,
  socketPath = '/run/baci-worker-release/broker.sock',
  githubToken,
  oidcToken,
  oidcRequestUrl,
  oidcRequestToken,
  fetchImpl = fetch,
  exchangeImpl = exchangeWorkerRelease,
}) {
  if (!['readiness', 'gigl-capability', 'recovery-status', 'recover', 'promote', 'health', 'rollback'].includes(operation)) fail('release operation is invalid');
  if (!SHA_RE.test(sha ?? '')) fail('source SHA is invalid');
  if (typeof githubToken !== 'string' || githubToken.length < 1 || githubToken.length > 4096) fail('GitHub token is unavailable');
  const signedToken = oidcToken ?? await readOidcToken({
    requestUrl: oidcRequestUrl,
    requestToken: oidcRequestToken,
    audience: `https://github.com/${REPOSITORY}`,
    fetchImpl,
  });
  if (typeof signedToken !== 'string' || signedToken.length < 1 || signedToken.length > 16_384) fail('OIDC token is invalid');
  if (operation === 'recover' && recoveryOf !== undefined &&
      (!recoveryOf || Object.keys(recoveryOf).sort().join(',') !== 'job_id,run_attempt,run_id,sha' ||
       !/^[1-9][0-9]{0,19}$/.test(String(recoveryOf.run_id)) ||
       !Number.isSafeInteger(recoveryOf.run_attempt) || recoveryOf.run_attempt < 1 ||
       !/^[1-9][0-9]{0,19}$/.test(String(recoveryOf.job_id)) || !SHA_RE.test(recoveryOf.sha ?? ''))) {
    fail('recovery target is invalid');
  }
  const request = { operation, sourceSha: sha, oidcToken: signedToken, githubToken,
    ...(operation === 'recover' && recoveryOf ? { recoveryOf } : {}) };
  const receipt = await exchangeImpl(socketPath, request);
  if (!validReceipt(receipt, { operation, sourceSha: sha, recoveryOf })) fail(`broker rejected or mismatched the ${operation} operation`);
  return receipt;
}

/** Authenticate the current coordinator run and inspect a staged tree without mutation. */
export async function preflightWorkerRelease({
  sha,
  socketPath = '/run/baci-worker-release/broker.sock',
  githubToken,
  oidcToken,
  oidcRequestUrl,
  oidcRequestToken,
  fetchImpl = fetch,
  exchangeImpl = exchangeWorkerRelease,
}) {
  if (!SHA_RE.test(sha ?? '')) fail('source SHA is invalid');
  if (typeof githubToken !== 'string' || githubToken.length < 1 || githubToken.length > 4096) fail('GitHub token is unavailable');
  const signedToken = oidcToken ?? await readOidcToken({
    requestUrl: oidcRequestUrl,
    requestToken: oidcRequestToken,
    audience: `https://github.com/${REPOSITORY}`,
    fetchImpl,
  });
  if (typeof signedToken !== 'string' || signedToken.length < 1 || signedToken.length > 16_384) fail('OIDC token is invalid');
  const request = { operation: 'preflight', sourceSha: sha, oidcToken: signedToken, githubToken };
  const receipt = await exchangeImpl(socketPath, request);
  if (receipt?.ok !== true || receipt.operation !== 'preflight' || receipt.sourceSha !== sha ||
      !Number.isSafeInteger(receipt.entryCount) || receipt.entryCount < 1) {
    fail('broker rejected or mismatched the worker release preflight');
  }
  return receipt;
}

/** Submit only a SHA-bound archive request; the broker owns extraction and staging. */
export async function stageWorkerRelease({
  sha,
  socketPath = '/run/baci-worker-release/broker.sock',
  githubToken,
  oidcToken,
  oidcRequestUrl,
  oidcRequestToken,
  fetchImpl = fetch,
  exchangeImpl = exchangeWorkerRelease,
}) {
  if (!SHA_RE.test(sha ?? '')) fail('source SHA is invalid');
  if (typeof githubToken !== 'string' || githubToken.length < 1 || githubToken.length > 4096) fail('GitHub token is unavailable');
  const bundleSha256 = await readArchiveDigest({ sha, githubToken, fetchImpl });
  const signedToken = oidcToken ?? await readOidcToken({
    requestUrl: oidcRequestUrl,
    requestToken: oidcRequestToken,
    audience: `https://github.com/${REPOSITORY}`,
    fetchImpl,
  });
  if (typeof signedToken !== 'string' || signedToken.length < 1 || signedToken.length > 16_384) fail('OIDC token is invalid');
  const request = {
    operation: 'stage', sourceSha: sha, bundleSha256, oidcToken: signedToken, githubToken,
  };
  const receipt = await exchangeImpl(socketPath, request);
  if (receipt?.ok !== true || receipt.operation !== 'stage' || receipt.sourceSha !== sha ||
      !Number.isSafeInteger(receipt.entryCount) || receipt.entryCount < 1) {
    fail('broker rejected or mismatched the worker release stage');
  }
  return receipt;
}

export async function stageWorkerReleaseFromEnvironment({ sha, socketPath, fetchImpl = fetch } = {}) {
  const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return stageWorkerRelease({
    sha: sha ?? process.env.BACI_EXPECTED_APP_SHA,
    socketPath,
    githubToken,
    oidcRequestUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
    oidcRequestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    fetchImpl,
  });
}
