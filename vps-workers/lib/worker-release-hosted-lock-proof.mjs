import {
  createPublicKey,
  sign as signBytes,
  verify as verifySignature,
} from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { dirname, sep } from 'node:path';

export const HOSTED_LOCK_PROOF_POLICY = Object.freeze({
  repository: 'ogabasseyy/Baci',
  repositoryId: '1100488586',
  coordinatorWorkflow: '.github/workflows/production-release.yml',
  reusableWorkflow: '.github/workflows/deploy.yml',
  jobName: 'Issue and synchronize cache worker token',
  environment: 'production',
  ref: 'refs/heads/main',
  expectedRunner: 'ubuntu-24.04',
  lockPath: '/home/baci-release/.local/state/baci/pending-production-release.json',
  lockWorkflow: '.github/workflows/production-release.yml',
  leaseIssuer: 'baci-worker-release-host-lock',
  leaseAudience: 'cache-worker-token-signer-production',
  leaseLifetimeSeconds: 60,
});

const GH_API = 'https://api.github.com';
const GH_ISSUER = 'https://token.actions.githubusercontent.com';
const GH_JWKS_URL = `${GH_ISSUER}/.well-known/jwks`;
const GH_DISCOVERY_URL = `${GH_ISSUER}/.well-known/openid-configuration`;
const SHA_RE = /^[0-9a-f]{40}$/;
const ID_RE = /^[1-9][0-9]{0,19}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const X5T_RE = /^[A-Za-z0-9_-]{27}$/;
const LEASE_HEADER = Object.freeze({ alg: 'EdDSA', kid: 'host-release-lock-v1', typ: 'JWT' });

function deny(message = 'hosted release lock proof denied') {
  throw new Error(message);
}

function decodePart(encoded) {
  if (!B64URL_RE.test(encoded ?? '')) deny();
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.toString('base64url') !== encoded) deny();
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) deny();
    return value;
  } catch {
    deny();
  }
}

function checkOidcSignature(token, jwks) {
  if (typeof token !== 'string' || token.length > 16_384) deny();
  const parts = token.split('.');
  if (parts.length !== 3) deny();
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (header.alg !== 'RS256' || header.typ !== 'JWT' || typeof header.kid !== 'string' ||
      Object.keys(header).some((key) => !['alg', 'kid', 'typ', 'x5t'].includes(key)) ||
      (header.x5t !== undefined && (!X5T_RE.test(header.x5t) || Buffer.from(header.x5t, 'base64url').toString('base64url') !== header.x5t))) deny();
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const matches = keys.filter((key) => key?.kid === header.kid && key.kty === 'RSA' && key.use === 'sig' && key.alg === 'RS256');
  if (matches.length !== 1 || !B64URL_RE.test(parts[2]) ||
      (header.x5t !== undefined && matches[0].x5t !== header.x5t)) deny();
  let publicKey;
  try { publicKey = createPublicKey({ key: matches[0], format: 'jwk' }); } catch { deny(); }
  const signature = Buffer.from(parts[2], 'base64url');
  const bits = publicKey.asymmetricKeyDetails?.modulusLength;
  if (signature.toString('base64url') !== parts[2] || !Number.isSafeInteger(bits) || bits < 2048 ||
      signature.length !== bits / 8 || !verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, signature)) deny();
  return claims;
}

function verifiedJobIdentity(claims, nowSeconds) {
  const workflowRef = `${HOSTED_LOCK_PROOF_POLICY.repository}/${HOSTED_LOCK_PROOF_POLICY.coordinatorWorkflow}@${HOSTED_LOCK_PROOF_POLICY.ref}`;
  const jobWorkflowRef = `${HOSTED_LOCK_PROOF_POLICY.repository}/${HOSTED_LOCK_PROOF_POLICY.reusableWorkflow}@${HOSTED_LOCK_PROOF_POLICY.ref}`;
  if (claims.iss !== GH_ISSUER || claims.aud !== `https://github.com/${HOSTED_LOCK_PROOF_POLICY.repository}` ||
      !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.nbf) || !Number.isSafeInteger(claims.exp) ||
      claims.iat > nowSeconds + 30 || claims.iat < nowSeconds - 600 || claims.nbf > nowSeconds + 30 ||
      claims.exp <= nowSeconds || claims.exp <= claims.iat || claims.exp - claims.iat > 600 ||
      claims.repository !== HOSTED_LOCK_PROOF_POLICY.repository || String(claims.repository_id) !== HOSTED_LOCK_PROOF_POLICY.repositoryId ||
      claims.workflow_ref !== workflowRef || claims.job_workflow_ref !== jobWorkflowRef ||
      claims.ref !== HOSTED_LOCK_PROOF_POLICY.ref || claims.ref_type !== 'branch' ||
      claims.environment !== HOSTED_LOCK_PROOF_POLICY.environment ||
      claims.sub !== `repo:${HOSTED_LOCK_PROOF_POLICY.repository}:environment:${HOSTED_LOCK_PROOF_POLICY.environment}` ||
      claims.runner_environment !== 'github-hosted' ||
      !['push', 'schedule', 'workflow_dispatch'].includes(claims.event_name) ||
      !SHA_RE.test(claims.sha ?? '') || !ID_RE.test(String(claims.run_id ?? '')) ||
      !ID_RE.test(String(claims.run_attempt ?? '')) || !ID_RE.test(String(claims.check_run_id ?? ''))) deny();
  return Object.freeze({
    runId: String(claims.run_id), runAttempt: Number(claims.run_attempt),
    jobId: String(claims.check_run_id), sha: claims.sha, event: claims.event_name,
  });
}

async function getJson(fetchImpl, url, token) {
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: 'error', signal: AbortSignal.timeout(5_000),
      headers: token ? { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } : {},
    });
  } catch { deny('hosted release proof dependency unavailable'); }
  if (!response.ok) deny('hosted release proof dependency unavailable');
  try { return await response.json(); } catch { deny('hosted release proof dependency response invalid'); }
}

async function authenticateGitHubJob({ oidcToken, githubToken, fetchImpl, nowSeconds }) {
  if (typeof githubToken !== 'string' || githubToken.length < 1 || githubToken.length > 4096) deny();
  const metadata = await getJson(fetchImpl, GH_DISCOVERY_URL);
  if (metadata.issuer !== GH_ISSUER || metadata.jwks_uri !== GH_JWKS_URL) deny();
  const claims = checkOidcSignature(oidcToken, await getJson(fetchImpl, GH_JWKS_URL));
  const identity = verifiedJobIdentity(claims, nowSeconds);
  const root = `${GH_API}/repos/${HOSTED_LOCK_PROOF_POLICY.repository}`;
  const workflow = await getJson(fetchImpl, `${root}/actions/workflows/${HOSTED_LOCK_PROOF_POLICY.coordinatorWorkflow}`, githubToken);
  if (workflow.path !== HOSTED_LOCK_PROOF_POLICY.coordinatorWorkflow || workflow.state !== 'active' || !Number.isSafeInteger(workflow.id)) deny();
  const run = await getJson(fetchImpl, `${root}/actions/runs/${identity.runId}`, githubToken);
  if (run.id !== Number(identity.runId) || run.workflow_id !== workflow.id || run.path !== HOSTED_LOCK_PROOF_POLICY.coordinatorWorkflow ||
      run.event !== identity.event || run.head_branch !== 'main' || run.head_sha !== identity.sha || run.status !== 'in_progress' ||
      run.run_attempt !== identity.runAttempt) deny();
  const jobs = await getJson(fetchImpl, `${root}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}/jobs?per_page=100`, githubToken);
  const job = Array.isArray(jobs.jobs) ? jobs.jobs.find((candidate) => candidate.id === Number(identity.jobId)) : null;
  if (!job || job.run_id !== run.id || job.name !== HOSTED_LOCK_PROOF_POLICY.jobName || job.status !== 'in_progress' ||
      job.head_sha !== identity.sha || !Array.isArray(job.labels) || !job.labels.includes(HOSTED_LOCK_PROOF_POLICY.expectedRunner)) deny();
  const ref = await getJson(fetchImpl, `${root}/git/ref/heads/main`, githubToken);
  if (ref.object?.sha !== identity.sha) deny();
  return identity;
}

function assertTrustedPathComponents(path, expectedUid) {
  if (path !== HOSTED_LOCK_PROOF_POLICY.lockPath) deny('release lock path is not the pinned path');
  const parts = path.split(sep).filter(Boolean);
  let current = sep;
  for (const part of parts) {
    current = current === sep ? `${current}${part}` : `${current}${sep}${part}`;
    const item = lstatSync(current);
    if (item.isSymbolicLink() || (current !== path && (!item.isDirectory() ||
        ![0, expectedUid].includes(item.uid) || (item.mode & 0o022) !== 0))) deny('release lock path metadata is untrusted');
  }
}

export function readHostReleaseLock({ expectedUid, path = HOSTED_LOCK_PROOF_POLICY.lockPath }) {
  if (!Number.isSafeInteger(expectedUid) || expectedUid <= 0) deny('release lock owner configuration is unavailable');
  assertTrustedPathComponents(path, expectedUid);
  const parent = lstatSync(dirname(path));
  const before = lstatSync(path);
  if (!parent.isDirectory() || parent.uid !== expectedUid || (parent.mode & 0o022) !== 0 ||
      !before.isFile() || before.uid !== expectedUid || (before.mode & 0o077) !== 0 || before.size < 1 || before.size > 4096) deny('release lock metadata is untrusted');
  if (!Number.isSafeInteger(fsConstants.O_NOFOLLOW)) deny('no-follow file open is unavailable');
  const flags = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
  const fd = openSync(path, flags);
  try {
    const after = fstatSync(fd);
  if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.uid !== expectedUid ||
      (after.mode & 0o077) !== 0 || after.size < 1 || after.size > 4096) deny('release lock changed while opening');
    let data = readFileSync(fd, 'utf8');
    if (!data.endsWith('\n') || data.indexOf('\n') !== data.length - 1) deny('release lock format is invalid');
    data = data.slice(0, -1);
    const lock = JSON.parse(data);
    const expectedFields = ['run_id', 'run_attempt', 'sha', 'state', 'workflow'];
    if (!lock || typeof lock !== 'object' || Array.isArray(lock) ||
        Object.keys(lock).sort().join(',') !== expectedFields.sort().join(',') ||
        lock.workflow !== HOSTED_LOCK_PROOF_POLICY.lockWorkflow ||
        !['worker_syncing', 'publishing'].includes(lock.state) || !ID_RE.test(String(lock.run_id)) ||
        !Number.isSafeInteger(lock.run_attempt) || lock.run_attempt < 1 || !SHA_RE.test(lock.sha ?? '')) deny('release lock contents are invalid');
    return Object.freeze({ runId: String(lock.run_id), runAttempt: lock.run_attempt, sha: lock.sha, state: lock.state,
      device: String(after.dev), inode: String(after.ino) });
  } finally { closeSync(fd); }
}

export function createHostedReleaseLockProofIssuer({
  expectedReleaseUid,
  signingPrivateKey,
  fetchImpl = fetch,
  nowSeconds = () => Math.floor(Date.now() / 1000),
  readLock = () => readHostReleaseLock({ expectedUid: expectedReleaseUid }),
} = {}) {
  if (!Number.isSafeInteger(expectedReleaseUid) || expectedReleaseUid <= 0 ||
      !signingPrivateKey || signingPrivateKey.asymmetricKeyType !== 'ed25519' ||
      typeof fetchImpl !== 'function' || typeof nowSeconds !== 'function' || typeof readLock !== 'function') {
    deny('host proof issuer configuration is unavailable');
  }
  return async ({ oidcToken, githubToken } = {}) => {
    const issuedAt = nowSeconds();
    if (!Number.isSafeInteger(issuedAt) || issuedAt < 1) deny();
    const identity = await authenticateGitHubJob({ oidcToken, githubToken, fetchImpl, nowSeconds: issuedAt });
    const lock = readLock();
    if (!lock || lock.runId !== identity.runId || lock.runAttempt !== identity.runAttempt || lock.sha !== identity.sha ||
        !['worker_syncing', 'publishing'].includes(lock.state)) deny('active host release lock does not match the authenticated job');
    const payload = {
      iss: HOSTED_LOCK_PROOF_POLICY.leaseIssuer,
      aud: HOSTED_LOCK_PROOF_POLICY.leaseAudience,
      iat: issuedAt,
      exp: issuedAt + HOSTED_LOCK_PROOF_POLICY.leaseLifetimeSeconds,
      run_id: identity.runId,
      run_attempt: identity.runAttempt,
      job_id: identity.jobId,
      sha: identity.sha,
      lock_state: lock.state,
      lock_device: lock.device,
      lock_inode: lock.inode,
    };
    const encodedHeader = Buffer.from(JSON.stringify(LEASE_HEADER)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const input = `${encodedHeader}.${encodedPayload}`;
    const signature = signBytes(null, Buffer.from(input, 'ascii'), signingPrivateKey).toString('base64url');
    return `${input}.${signature}`;
  };
}

/** Verify signature, fixed audience and age only; this never proves the lock is still live. */
export function verifyHostedReleaseLockLease({ token, publicKey, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  if (typeof token !== 'string' || token.length > 8192 || !Number.isSafeInteger(nowSeconds) || nowSeconds < 1) deny();
  const parts = token.split('.');
  if (parts.length !== 3) deny();
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  const fields = ['aud', 'exp', 'iat', 'iss', 'job_id', 'lock_device', 'lock_inode', 'lock_state', 'run_attempt', 'run_id', 'sha'];
  if (header.alg !== 'EdDSA' || header.kid !== LEASE_HEADER.kid || header.typ !== 'JWT' ||
      Object.keys(header).length !== 3 || Object.keys(claims).sort().join(',') !== fields.join(',') ||
      claims.iss !== HOSTED_LOCK_PROOF_POLICY.leaseIssuer || claims.aud !== HOSTED_LOCK_PROOF_POLICY.leaseAudience ||
      !Number.isSafeInteger(claims.iat) || claims.iat > nowSeconds + 5 || claims.iat < nowSeconds - HOSTED_LOCK_PROOF_POLICY.leaseLifetimeSeconds ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= nowSeconds || claims.exp - claims.iat > HOSTED_LOCK_PROOF_POLICY.leaseLifetimeSeconds ||
      !ID_RE.test(String(claims.run_id)) || !Number.isSafeInteger(claims.run_attempt) || claims.run_attempt < 1 ||
      !ID_RE.test(String(claims.job_id)) || !SHA_RE.test(claims.sha ?? '') ||
      !['worker_syncing', 'publishing'].includes(claims.lock_state) || !/^\d+$/.test(claims.lock_device ?? '') || !/^\d+$/.test(claims.lock_inode ?? '') ||
      !B64URL_RE.test(parts[2])) deny();
  const key = publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || !verifySignature(null, Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'), key, Buffer.from(parts[2], 'base64url'))) deny();
  return Object.freeze({
    runId: claims.run_id, runAttempt: claims.run_attempt, jobId: claims.job_id,
    sha: claims.sha, lockState: claims.lock_state,
    lockDevice: claims.lock_device, lockInode: claims.lock_inode,
  });
}

/**
 * Recheck a broker lease at the moment the remote signer is about to act.
 * This is a fresh host/GitHub observation, not an atomic cross-host fence.
 */
export function createHostedReleaseActionAuthorizer({
  expectedReleaseUid,
  leasePublicKey,
  fetchImpl = fetch,
  nowSeconds = () => Math.floor(Date.now() / 1000),
  readLock = () => readHostReleaseLock({ expectedUid: expectedReleaseUid }),
} = {}) {
  if (!Number.isSafeInteger(expectedReleaseUid) || expectedReleaseUid <= 0 ||
      !leasePublicKey || typeof fetchImpl !== 'function' || typeof nowSeconds !== 'function' || typeof readLock !== 'function') {
    deny('host action authorizer configuration is unavailable');
  }
  return async ({ lease, oidcToken, githubToken } = {}) => {
    const currentTime = nowSeconds();
    if (!Number.isSafeInteger(currentTime) || currentTime < 1) deny();
    const leaseIdentity = verifyHostedReleaseLockLease({ token: lease, publicKey: leasePublicKey, nowSeconds: currentTime });
    const identity = await authenticateGitHubJob({ oidcToken, githubToken, fetchImpl, nowSeconds: currentTime });
    const lock = readLock();
    if (!lock || lock.runId !== identity.runId || lock.runAttempt !== identity.runAttempt || lock.sha !== identity.sha ||
        lock.state !== leaseIdentity.lockState || lock.device !== leaseIdentity.lockDevice ||
        lock.inode !== leaseIdentity.lockInode || leaseIdentity.runId !== identity.runId ||
        leaseIdentity.runAttempt !== identity.runAttempt || leaseIdentity.jobId !== identity.jobId || leaseIdentity.sha !== identity.sha) {
      deny('fresh host lock evidence does not match the signer action');
    }
    return identity;
  };
}
