import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { proveCompletedWorkerAttempt } from './worker-release-github-proof.mjs';

/** Fail-closed authentication and policy for the privileged release broker. */
export const WORKER_RELEASE_BROKER_POLICY = Object.freeze({
  repository: 'ogabasseyy/Baci',
  workflow: '.github/workflows/production-release.yml',
  readinessWorkflow: '.github/workflows/deploy.yml',
  readinessJob: 'vps-drain-readiness',
  runnerLabel: 'baci-release',
  branch: 'refs/heads/main',
  operations: Object.freeze(['stage', 'preflight', 'readiness', 'gigl-capability', 'recovery-status', 'recover', 'promote', 'health', 'rollback']),
  maxBundleBytes: 256 * 1024 * 1024,
  authorizationDeadlineMs: 330_000,
  githubRequestTimeoutMs: 30_000,
  dispatcherTimeoutMs: 360_000,
  quiescenceReadyTimeoutMs: 630_000,
  quiescenceCleanupTimeoutMs: 35_000,
  brokerOperationBudgetMs: 1_080_000,
  brokerClientTimeoutMs: 1_140_000,
  workerRoot: '/srv/baci-workers',
});

const SHA_RE = /^[0-9a-f]{40}$/;
const ID_RE = /^[1-9][0-9]{0,19}$/;
const OP_SET = new Set(WORKER_RELEASE_BROKER_POLICY.operations);
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_API = 'https://api.github.com';

function fail(message) {
  throw new Error(`worker release broker: ${message}`);
}

function decodeJwtPart(value, label) {
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { fail(`invalid OIDC ${label}`); }
}

export function verifyBrokerOidcToken(token, jwks, { now = Date.now(), audience = `https://github.com/${WORKER_RELEASE_BROKER_POLICY.repository}` } = {}) {
  if (typeof token !== 'string') fail('OIDC token is required');
  const pieces = token.split('.');
  if (pieces.length !== 3) fail('invalid OIDC token');
  const header = decodeJwtPart(pieces[0], 'header');
  const claims = decodeJwtPart(pieces[1], 'claims');
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') fail('unsupported OIDC signature');
  const jwk = jwks?.keys?.find((key) => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig');
  if (!jwk) fail('OIDC signing key unavailable');
  let valid = false;
  try {
    valid = verifySignature('RSA-SHA256', Buffer.from(`${pieces[0]}.${pieces[1]}`),
      createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(pieces[2], 'base64url'));
  } catch { /* malformed key/signature is denied below */ }
  if (!valid) fail('OIDC signature verification failed');
  const nowSeconds = Math.floor(now / 1000);
  if (claims.iss !== OIDC_ISSUER || claims.aud !== audience || !Number.isInteger(claims.exp) || claims.exp <= nowSeconds ||
      !Number.isInteger(claims.nbf) || claims.nbf > nowSeconds || !Number.isInteger(claims.iat) || claims.iat > nowSeconds + 30) {
    fail('OIDC issuer, audience, or time claims invalid');
  }
  if (claims.repository !== WORKER_RELEASE_BROKER_POLICY.repository ||
      claims.workflow_ref !== `${WORKER_RELEASE_BROKER_POLICY.repository}/${WORKER_RELEASE_BROKER_POLICY.workflow}@refs/heads/main` ||
      ![
        `${WORKER_RELEASE_BROKER_POLICY.repository}/${WORKER_RELEASE_BROKER_POLICY.workflow}@refs/heads/main`,
        `${WORKER_RELEASE_BROKER_POLICY.repository}/${WORKER_RELEASE_BROKER_POLICY.readinessWorkflow}@refs/heads/main`,
      ].includes(claims.job_workflow_ref) ||
      claims.ref !== WORKER_RELEASE_BROKER_POLICY.branch || claims.ref_type !== 'branch' ||
      !['push', 'workflow_dispatch'].includes(claims.event_name) || !SHA_RE.test(claims.sha ?? '') ||
      !ID_RE.test(String(claims.repository_id ?? '')) || !ID_RE.test(String(claims.run_id ?? '')) ||
      !Number.isSafeInteger(Number(claims.run_attempt)) || Number(claims.run_attempt) < 1 ||
      !ID_RE.test(String(claims.check_run_id ?? '')) || claims.runner_environment !== 'self-hosted') {
    fail('OIDC coordinator job claims invalid');
  }
  return claims;
}

function createDeadlineBudget({ clock = () => performance.now(), timeoutMs = WORKER_RELEASE_BROKER_POLICY.authorizationDeadlineMs } = {}) {
  const deadline = clock() + timeoutMs;
  const remaining = () => {
    const value = deadline - clock();
    if (value <= 0) fail('broker authorization exceeded its total deadline');
    return value;
  };
  return {
    signal(timeoutMs = WORKER_RELEASE_BROKER_POLICY.githubRequestTimeoutMs) { return AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(timeoutMs, remaining())))); },
    check: remaining,
    async fetch(fetchImpl, input, options = {}, timeoutMs = WORKER_RELEASE_BROKER_POLICY.githubRequestTimeoutMs) {
      const response = await fetchImpl(input, { ...options, signal: this.signal(timeoutMs) });
      this.check();
      return response;
    },
    async json(response) {
      const value = await response.json();
      this.check();
      return value;
    },
  };
}

async function githubJson(fetchImpl, url, token, budget) {
  const response = await budget.fetch(fetchImpl, url, { headers: {
    authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  } });
  if (!response.ok) fail(`GitHub API request failed (${response.status})`);
  return budget.json(response);
}

async function authenticateJob({ oidcToken, githubToken, operation, fetchImpl, now, budget }) {
  if (typeof oidcToken !== 'string' || oidcToken.length < 1 || oidcToken.length > 16_384) fail('OIDC token is missing or oversized');
  if (typeof githubToken !== 'string' || githubToken.length < 1 || githubToken.length > 4096) fail('GitHub API credential is missing');
  const discoveryResponse = await budget.fetch(fetchImpl, `${OIDC_ISSUER}/.well-known/openid-configuration`);
  if (!discoveryResponse.ok) fail('GitHub OIDC discovery unavailable');
  const discovery = await budget.json(discoveryResponse);
  if (discovery.issuer !== OIDC_ISSUER || discovery.jwks_uri !== `${OIDC_ISSUER}/.well-known/jwks`) fail('unexpected GitHub OIDC metadata');
  const keyResponse = await budget.fetch(fetchImpl, discovery.jwks_uri);
  if (!keyResponse.ok) fail('GitHub OIDC signing keys unavailable');
  const claims = verifyBrokerOidcToken(oidcToken, await budget.json(keyResponse), { now });
  const readinessRequest = operation === 'readiness';
  const giglCapabilityRequest = operation === 'gigl-capability';
  const deployWorkflowRequest = readinessRequest || giglCapabilityRequest;
  const expectedJobWorkflow = `${WORKER_RELEASE_BROKER_POLICY.repository}/${deployWorkflowRequest ? WORKER_RELEASE_BROKER_POLICY.readinessWorkflow : WORKER_RELEASE_BROKER_POLICY.workflow}@refs/heads/main`;
  if (claims.job_workflow_ref !== expectedJobWorkflow) fail('coordinator job workflow does not match operation policy');
  const repo = WORKER_RELEASE_BROKER_POLICY.repository;
  const repository = await githubJson(fetchImpl, `${GITHUB_API}/repos/${repo}`, githubToken, budget);
  if (repository.full_name?.toLowerCase() !== repo.toLowerCase() || repository.id !== Number(claims.repository_id)) fail('canonical repository identity mismatch');
  const workflow = await githubJson(fetchImpl, `${GITHUB_API}/repos/${repo}/actions/workflows/${WORKER_RELEASE_BROKER_POLICY.workflow}`, githubToken, budget);
  if (workflow.path !== WORKER_RELEASE_BROKER_POLICY.workflow || workflow.state !== 'active' || !Number.isSafeInteger(workflow.id)) fail('coordinator workflow is unavailable');
  const run = await githubJson(fetchImpl, `${GITHUB_API}/repos/${repo}/actions/runs/${claims.run_id}`, githubToken, budget);
  const pinnedPath = [WORKER_RELEASE_BROKER_POLICY.workflow, `${WORKER_RELEASE_BROKER_POLICY.workflow}@main`, `${WORKER_RELEASE_BROKER_POLICY.workflow}@refs/heads/main`];
  if (run.id !== Number(claims.run_id) || run.workflow_id !== workflow.id || !pinnedPath.includes(run.path) ||
      run.event !== claims.event_name || run.head_branch !== 'main' || run.head_sha !== claims.sha ||
      run.status !== 'in_progress' || run.run_attempt !== Number(claims.run_attempt)) fail('coordinator run does not match signed job identity');
  const jobs = await githubJson(fetchImpl, `${GITHUB_API}/repos/${repo}/actions/runs/${claims.run_id}/attempts/${claims.run_attempt}/jobs?per_page=100`, githubToken, budget);
  const job = Array.isArray(jobs.jobs) ? jobs.jobs.find((candidate) => candidate.id === Number(claims.check_run_id)) : null;
  const expectedJobNames = readinessRequest
    ? [WORKER_RELEASE_BROKER_POLICY.readinessJob, 'Deploy to Vercel']
    : [giglCapabilityRequest ? 'gigl-worker-capability' : 'Sync VPS workers'];
  if (!job || job.run_id !== run.id || !expectedJobNames.includes(job.name) || job.status !== 'in_progress' || job.head_sha !== claims.sha ||
      !Array.isArray(job.labels) || !job.labels.includes(WORKER_RELEASE_BROKER_POLICY.runnerLabel) || typeof job.runner_name !== 'string' || !job.runner_name) fail('signed OIDC check run is not the active worker job');
  const ref = await githubJson(fetchImpl, `${GITHUB_API}/repos/${repo}/git/ref/heads/main`, githubToken, budget);
  const allowInFlightRecovery = ['health', 'rollback'].includes(operation);
  if (!allowInFlightRecovery && ref.object?.sha !== claims.sha) fail('coordinator SHA is no longer current main');
  return { claims, run, job, currentMainSha: ref.object.sha };
}

async function fetchCommitArchive(fetchImpl, githubToken, sha, budget) {
  const apiUrl = `${GITHUB_API}/repos/${WORKER_RELEASE_BROKER_POLICY.repository}/tarball/${sha}`;
  const response = await budget.fetch(fetchImpl, apiUrl, { redirect: 'manual', headers: {
    authorization: `Bearer ${githubToken}`, accept: 'application/vnd.github+json',
  } });
  if (response.status !== 302 && response.status !== 301) fail('GitHub source archive did not redirect as expected');
  const location = new URL(response.headers.get('location') ?? '');
  if (location.protocol !== 'https:' || location.hostname !== 'codeload.github.com' ||
      location.pathname !== `/ogabasseyy/Baci/legacy.tar.gz/${sha}`) fail('unexpected GitHub archive redirect');
  const archiveResponse = await budget.fetch(fetchImpl, location, { redirect: 'error' }, 120_000);
  if (!archiveResponse.ok) fail(`GitHub source archive request failed (${archiveResponse.status})`);
  const declaredLength = Number(archiveResponse.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > WORKER_RELEASE_BROKER_POLICY.maxBundleBytes) fail('source archive exceeds size limit');
  if (!archiveResponse.body) fail('GitHub source archive is empty');
  const reader = archiveResponse.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    budget.check();
    const { done, value } = await reader.read();
    budget.check();
    if (done) break;
    length += value.byteLength;
    if (length > WORKER_RELEASE_BROKER_POLICY.maxBundleBytes) {
      await reader.cancel();
      fail('source archive exceeds size limit');
    }
    chunks.push(Buffer.from(value));
  }
  const bytes = Buffer.concat(chunks, length);
  if (bytes.length === 0) fail('source archive is empty');
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function validateIdentity(identity, expectedSha) {
  if (!identity || identity.repository !== WORKER_RELEASE_BROKER_POLICY.repository ||
      identity.workflow !== WORKER_RELEASE_BROKER_POLICY.workflow ||
      identity.ref !== WORKER_RELEASE_BROKER_POLICY.branch ||
      !['push', 'workflow_dispatch'].includes(identity.event) ||
      identity.runnerLabel !== WORKER_RELEASE_BROKER_POLICY.runnerLabel || identity.status !== 'in_progress' ||
      !SHA_RE.test(identity.sha ?? '') || identity.sha !== expectedSha ||
      !ID_RE.test(String(identity.runId ?? '')) || !ID_RE.test(String(identity.jobId ?? '')) ||
      !Number.isSafeInteger(identity.runAttempt) || identity.runAttempt < 1 ||
      typeof identity.runnerName !== 'string' || identity.runnerName.length < 1 || identity.runnerName.length > 128) {
    fail('authenticated coordinator job identity is invalid');
  }
}

/** Authenticate the job and bind the worker input to GitHub's exact commit archive. */
export async function authorizeBrokerRequest({ peerUid, expectedReleaseUid, workerUid, request, fetchImpl = fetch, now = Date.now(), deadlineClock }) {
  if (!Number.isSafeInteger(expectedReleaseUid) || expectedReleaseUid <= 0 || !Number.isSafeInteger(workerUid) || workerUid <= 0 ||
      expectedReleaseUid === workerUid) fail('trusted broker account configuration is invalid');
  if (peerUid !== expectedReleaseUid) fail('unauthorized peer identity');
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail('request must be an object');
  const keys = Object.keys(request).sort();
  const { operation, sourceSha, bundleSha256, oidcToken, githubToken } = request;
  if (!OP_SET.has(operation)) fail('unknown operation');
  const expectedKeys = operation === 'stage'
    ? 'bundleSha256,githubToken,oidcToken,operation,sourceSha'
    : operation === 'recover'
      ? null
      : 'githubToken,oidcToken,operation,sourceSha';
  if (operation === 'recover') {
    if (!['githubToken,oidcToken,operation,sourceSha',
          'githubToken,oidcToken,operation,recoveryOf,sourceSha'].includes(keys.join(','))) {
      fail('request contains unsupported fields');
    }
  } else if (keys.join(',') !== expectedKeys) fail('request contains unsupported fields');
  if (!SHA_RE.test(sourceSha ?? '')) fail('source SHA is invalid');
  if (operation === 'stage' && !/^[0-9a-f]{64}$/.test(bundleSha256 ?? '')) fail('bundle digest is invalid');
  const budget = createDeadlineBudget({ clock: deadlineClock });
  const verifiedJob = await authenticateJob({ oidcToken, githubToken, operation, fetchImpl, now, budget });
  // A promotion already in flight must still be health-checked or rolled back
  // if main advances during the deployment. The privileged Python dispatcher
  // separately requires the exact persisted run fence/state for both actions.
  // All new mutations and stage/readiness operations remain pinned to main.
  if (!['health', 'rollback'].includes(operation) && verifiedJob.currentMainSha !== sourceSha) {
    fail('source SHA is not current main');
  }
  let recoveryOf;
  if (operation === 'recover') {
    const target = request.recoveryOf;
    if (target !== undefined) {
      if (!target || Object.keys(target).sort().join(',') !== 'job_id,run_attempt,run_id,sha') fail('recovery target fields are invalid');
      try {
        recoveryOf = await proveCompletedWorkerAttempt({
          target,
          repository: WORKER_RELEASE_BROKER_POLICY.repository,
          workflowId: verifiedJob.run.workflow_id,
          runnerLabel: WORKER_RELEASE_BROKER_POLICY.runnerLabel,
          apiJson: async (pathname) => githubJson(fetchImpl, `${GITHUB_API}${pathname}`, githubToken, budget),
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : 'prior worker attempt cannot be proven terminal');
      }
    }
  }
  validateIdentity({
    repository: verifiedJob.claims.repository,
    workflow: WORKER_RELEASE_BROKER_POLICY.workflow,
    ref: verifiedJob.claims.ref,
    event: verifiedJob.claims.event_name,
    runnerLabel: WORKER_RELEASE_BROKER_POLICY.runnerLabel,
    status: verifiedJob.run.status,
    sha: verifiedJob.claims.sha,
    runId: verifiedJob.claims.run_id,
    runAttempt: Number(verifiedJob.claims.run_attempt),
    jobId: verifiedJob.job.id,
    runnerName: verifiedJob.job.runner_name,
  }, sourceSha);
  let archive;
  if (operation === 'stage') {
    archive = await fetchCommitArchive(fetchImpl, githubToken, sourceSha, budget);
    if (archive.sha256 !== bundleSha256) fail('bundle digest does not match GitHub source at the authenticated SHA');
  }
  return Object.freeze({
    operation,
    sourceSha,
    repository: verifiedJob.claims.repository,
    workflow: WORKER_RELEASE_BROKER_POLICY.workflow,
    ref: verifiedJob.claims.ref,
    status: verifiedJob.run.status,
    ...(operation === 'stage' ? { bundleSha256 } : {}),
    runId: String(verifiedJob.claims.run_id),
    runAttempt: Number(verifiedJob.claims.run_attempt),
    jobId: String(verifiedJob.job.id),
    workerUid,
    workerRoot: WORKER_RELEASE_BROKER_POLICY.workerRoot,
    ...(operation === 'stage' ? { sourceArchive: archive.bytes } : {}),
    ...(operation === 'recover' && recoveryOf ? { recoveryOf } : {}),
  });
}

/**
 * Archive validators should call this for every entry before extraction.
 * Only ordinary files/directories with normalized relative POSIX paths are
 * accepted. Link/device/FIFO entries must be rejected by the archive reader.
 */
export function validateBundleManifest(entries, totalBytes) {
  if (!Array.isArray(entries) || entries.length === 0) fail('bundle manifest is empty');
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0 || totalBytes > WORKER_RELEASE_BROKER_POLICY.maxBundleBytes) {
    fail('bundle exceeds size limit');
  }
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || !['file', 'directory'].includes(entry.type) || typeof entry.path !== 'string' ||
        entry.path.length === 0 || entry.path.length > 1024 || entry.path.startsWith('/') ||
        entry.path.includes('\\') || entry.path.split('/').some((part) => part === '' || part === '.' || part === '..') ||
        seen.has(entry.path) || (entry.type === 'file' && (!Number.isSafeInteger(entry.size) || entry.size < 0))) {
      fail('bundle contains an unsafe or duplicate entry');
    }
    seen.add(entry.path);
  }
  return true;
}
