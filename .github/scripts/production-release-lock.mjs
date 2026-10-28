import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { authorizeCoordinatorJob, COORDINATOR_WORKFLOW_PATH, RELEASE_REPOSITORY, WORKER_JOB_NAME } from './authorize-coordinator-worker.mjs';

export const PRODUCTION_RELEASE_LOCK_PATH = '/home/baci-release/.local/state/baci/pending-production-release.json';
const WEB_PROJECT_ID = 'prj_y6kGI7ZzyFWU6tyZbaklPtVsXeqx';
const TEAM_ID = 'team_P85yMqd79TPq8aSGSt2kojWY';
const HEX_SHA = /^[0-9a-f]{40}$/;

export function validateProductionLockHost({ username, uid, expectedUid, home, host }) {
  if (username !== 'baci-release' || !Number.isSafeInteger(uid) || uid <= 0 || uid !== expectedUid ||
      home !== '/home/baci-release' || typeof host !== 'string' || host.split('.')[0] !== 'ogabassey') {
    throw new Error('production release lock is restricted to the verified baci-release identity on ogabassey');
  }
}

function assertExpectedLockHost(env) {
  const identity = userInfo();
  validateProductionLockHost({ username: identity.username, uid: process.getuid(), expectedUid: identity.uid, home: identity.homedir, host: hostname() });
  if (env.HOME !== identity.homedir) {
    throw new Error('production release lock HOME does not match the verified baci-release account');
  }
}

function assertPrivateParent(lockPath) {
  const parent = lstatSync(dirname(lockPath));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid() || (parent.mode & 0o022) !== 0) {
    throw new Error('production release lock directory is not privately owned');
  }
}

function validatePayload(payload) {
  if (!payload || !/^[1-9][0-9]*$/.test(String(payload.run_id)) || !Number.isSafeInteger(Number(payload.run_attempt)) ||
      Number(payload.run_attempt) < 1 || !HEX_SHA.test(payload.sha ?? '')) {
    throw new Error('invalid production release lock identity');
  }
  return { run_id: String(payload.run_id), run_attempt: Number(payload.run_attempt), sha: payload.sha };
}

export function acquireProductionReleaseLock(lockPath, payload) {
  const identity = validatePayload(payload);
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  assertPrivateParent(lockPath);
  let fd;
  try {
    fd = openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('production release lock already exists; reconcile the prior release before proceeding');
    throw error;
  }
  try {
    writeFileSync(fd, `${JSON.stringify({ ...identity, state: 'worker_syncing', workflow: COORDINATOR_WORKFLOW_PATH })}\n`, { encoding: 'utf8' });
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error('production release lock permissions are unsafe');
  } finally {
    closeSync(fd);
  }
  return identity;
}

export function readProductionReleaseLock(lockPath) {
  let stat;
  try {
    stat = lstatSync(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('production release lock is not a private regular file');
  if (stat.uid !== process.getuid()) throw new Error('production release lock is owned by another user');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const identity = validatePayload(lock);
  if (lock.workflow !== COORDINATOR_WORKFLOW_PATH || !['worker_syncing', 'publishing'].includes(lock.state)) {
    throw new Error('production release lock contents are invalid');
  }
  return { ...identity, state: lock.state, workflow: lock.workflow };
}

export function markProductionReleasePublishing(lockPath, payload) {
  const expected = validatePayload(payload);
  assertPrivateParent(lockPath);
  const lock = readProductionReleaseLock(lockPath);
  if (!lock || lock.run_id !== expected.run_id || lock.run_attempt !== expected.run_attempt || lock.sha !== expected.sha) {
    throw new Error('production release lock owner mismatch');
  }
  const temporary = `${lockPath}.${process.pid}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify({ ...expected, state: 'publishing', workflow: COORDINATOR_WORKFLOW_PATH })}\n`, 'utf8');
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, lockPath);
}

export function clearProductionReleaseLock(lockPath, payload) {
  const expected = validatePayload(payload);
  assertPrivateParent(lockPath);
  const lock = readProductionReleaseLock(lockPath);
  if (!lock || lock.run_id !== expected.run_id || lock.run_attempt !== expected.run_attempt || lock.sha !== expected.sha) {
    throw new Error('production release lock owner mismatch');
  }
  unlinkSync(lockPath);
}

export function assertNoopPublicationOutcome(publicationSucceeded) {
  if (publicationSucceeded !== 'false') {
    throw new Error('caller workflow did not prove that app publication was skipped');
  }
}

async function apiJson(fetchImpl, pathname, token) {
  const response = await fetchImpl(`https://api.github.com${pathname}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });
  if (!response.ok) throw new Error(`GitHub API request failed (${response.status})`);
  return response.json();
}

export function clearNoopProductionReleaseLock({ env, auth, lockPath = PRODUCTION_RELEASE_LOCK_PATH }) {
  assertNoopPublicationOutcome(env.BACI_APP_PUBLICATION_SUCCEEDED);
  const lock = readProductionReleaseLock(lockPath);
  if (!auth?.claims || !lock || lock.run_id !== auth.claims.run_id || lock.run_attempt !== Number(auth.claims.run_attempt) || lock.sha !== auth.claims.sha) {
    throw new Error('production release lock owner mismatch');
  }
  clearProductionReleaseLock(lockPath, lock);
}

/**
 * Require the exact active reusable-workflow job and persistent lock owner
 * before any cache-worker membership grant or revocation.
 */
export function assertCacheWorkerActionLockOwner({ auth, lockPath = PRODUCTION_RELEASE_LOCK_PATH }) {
  const lock = readProductionReleaseLock(lockPath);
  const claims = auth?.claims;
  if (!lock || lock.state !== 'worker_syncing' || !claims ||
      lock.run_id !== String(claims.run_id) ||
      lock.run_attempt !== Number(claims.run_attempt) || lock.sha !== claims.sha) {
    throw new Error('cache worker action requires the exact active production release lock owner');
  }
  return { run_id: lock.run_id, run_attempt: lock.run_attempt, sha: lock.sha };
}

export async function verifyLiveAliasAndWorker(auth, env, fetchImpl, lockPath = PRODUCTION_RELEASE_LOCK_PATH) {
  const workerVerification = auth.job.steps?.find((step) => step?.name === 'Verify exact worker SHA before lock release');
  if (workerVerification?.status !== 'completed' || workerVerification?.conclusion !== 'success') {
    throw new Error('exact worker SHA verification is not recorded as successful');
  }
  const lock = readProductionReleaseLock(lockPath);
  if (!lock || lock.run_id !== auth.claims.run_id || lock.run_attempt !== Number(auth.claims.run_attempt) || lock.sha !== auth.claims.sha) {
    throw new Error('production release lock owner mismatch');
  }
  const token = env.VERCEL_TOKEN;
  if (!token || env.VERCEL_PROJECT_ID !== WEB_PROJECT_ID || env.VERCEL_ORG_ID !== TEAM_ID) {
    throw new Error('Vercel production project access is unavailable or does not match the canonical app');
  }
  const scope = `teamId=${TEAM_ID}&projectId=${WEB_PROJECT_ID}`;
  const request = async (path) => {
    const response = await fetchImpl(`https://api.vercel.com${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Vercel API request failed (${response.status})`);
    return response.json();
  };
  const alias = await request(`/v4/aliases/ogabassey.com?${scope}`);
  const deploymentId = alias?.deploymentId;
  if (typeof deploymentId !== 'string' || !/^dpl_[A-Za-z0-9]+$/.test(deploymentId)) throw new Error('cannot identify production alias deployment');
  const deployment = await request(`/v13/deployments/${deploymentId}?${scope}`);
  const githubSha = deployment?.meta?.githubCommitSha ?? null;
  const gitSha = deployment?.meta?.gitCommitSha ?? null;
  const sha = githubSha ?? gitSha;
  if (githubSha !== null && gitSha !== null && githubSha !== gitSha || deployment?.projectId !== WEB_PROJECT_ID ||
      deployment?.readyState !== 'READY' || deployment?.target !== 'production' || sha !== auth.claims.sha) {
    throw new Error('live production deployment does not match the verified release');
  }
  const aliasAgain = await request(`/v4/aliases/ogabassey.com?${scope}`);
  if (aliasAgain?.deploymentId !== deploymentId) throw new Error('production alias changed during release verification');
  const ghToken = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (!ghToken) throw new Error('GitHub API access is unavailable for main SHA verification');
  const ref = await apiJson(fetchImpl, `/repos/${RELEASE_REPOSITORY}/git/ref/heads/main`, ghToken);
  if (ref.object?.sha !== auth.claims.sha) {
    throw new Error('release SHA is no longer current main');
  }
  clearProductionReleaseLock(lockPath, lock);
}

export async function runProductionReleaseLockCommand(command, { env = process.env, fetchImpl = fetch } = {}) {
  assertExpectedLockHost(env);
  if (command === 'authorize-worker-lock') {
    const lock = readProductionReleaseLock(PRODUCTION_RELEASE_LOCK_PATH);
    if (!lock) return;
    const auth = await authorizeCoordinatorJob({ env, fetchImpl, expectedJobName: WORKER_JOB_NAME });
    if (lock.run_id !== auth.claims.run_id || lock.run_attempt !== Number(auth.claims.run_attempt) || lock.sha !== auth.claims.sha) {
      throw new Error('another production release owns the persistent lock');
    }
    process.stdout.write(`${auth.claims.run_id}\t${auth.claims.sha}\t${auth.claims.run_attempt}\n`);
    return;
  }
  if (command === 'acquire') {
    const auth = await authorizeCoordinatorJob({ env, fetchImpl, expectedJobName: WORKER_JOB_NAME });
    acquireProductionReleaseLock(PRODUCTION_RELEASE_LOCK_PATH, {
      run_id: auth.claims.run_id, run_attempt: auth.claims.run_attempt, sha: auth.claims.sha,
    });
    return;
  }
  if (command === 'authorize-cache-worker-action') {
    const auth = await authorizeCoordinatorJob({
      env,
      fetchImpl,
      expectedJobName: 'Manage cache worker capability',
      expectedJobWorkflowPath: '.github/workflows/deploy.yml',
    });
    const lock = assertCacheWorkerActionLockOwner({ auth });
    process.stdout.write(`${lock.run_id}\t${lock.sha}\t${lock.run_attempt}\n`);
    return;
  }
  if (command === 'clear-noop') {
    const auth = await authorizeCoordinatorJob({ env, fetchImpl, expectedJobName: 'Release lock after a proven no-op' });
    return clearNoopProductionReleaseLock({ env, auth });
  }
  if (command === 'verify-publishing') {
    const auth = await authorizeCoordinatorJob({
      env, fetchImpl, expectedJobName: 'Deploy to Vercel', expectedJobWorkflowPath: '.github/workflows/deploy.yml',
    });
    const lock = readProductionReleaseLock(PRODUCTION_RELEASE_LOCK_PATH);
    if (!lock || lock.run_id !== auth.claims.run_id || lock.run_attempt !== Number(auth.claims.run_attempt) || lock.sha !== auth.claims.sha) {
      throw new Error('production release lock owner mismatch');
    }
    if (!env.VERCEL_TOKEN || env.VERCEL_PROJECT_ID !== WEB_PROJECT_ID || env.VERCEL_ORG_ID !== TEAM_ID) {
      throw new Error('Vercel production project access is unavailable or does not match the canonical app');
    }
    markProductionReleasePublishing(PRODUCTION_RELEASE_LOCK_PATH, lock);
    return;
  }
  if (command === 'finalize-published') {
    const auth = await authorizeCoordinatorJob({
      env, fetchImpl, expectedJobName: 'Deploy to Vercel', expectedJobWorkflowPath: '.github/workflows/deploy.yml',
    });
    markProductionReleasePublishing(PRODUCTION_RELEASE_LOCK_PATH, {
      run_id: auth.claims.run_id, run_attempt: auth.claims.run_attempt, sha: auth.claims.sha,
    });
    return verifyLiveAliasAndWorker(auth, env, fetchImpl);
  }
  throw new Error('expected acquire, authorize-cache-worker-action, verify-publishing, authorize-worker-lock, clear-noop, or finalize-published');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProductionReleaseLockCommand(process.argv[2]).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
