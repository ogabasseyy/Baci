import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireReleaseLock, assertLiveDeployment, coordinateRelease, IN_FLIGHT_RUN_STATUSES, releaseLockPath, selectCoordinatedRun } from './coordinate-production-release.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const repository = 'ogabasseyy/Baci';
const workerHost = 'bassey@82.29.190.219';
const coordinationId = randomUUID();

function command(binary, args, capture = true) {
  const result = spawnSync(binary, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error || result.status !== 0) {
    // Keep reconciliation context: which call failed, how, and the
    // first bytes of whatever it printed before dying.
    const output = typeof result.stdout === 'string' ? result.stdout.trim().slice(0, 500) : '';
    const cause = result.error ? ` (${result.error.message})` : '';
    throw new Error(`${binary} ${args.join(' ')} failed with status ${result.status}${cause}${output ? `: ${output}` : ''}; inspect preceding diagnostics`);
  }
  return capture ? result.stdout.trim() : '';
}

function gh(args) {
  return command('gh', args);
}

const vercelProjectId = 'prj_y6kGI7ZzyFWU6tyZbaklPtVsXeqx';
const vercelScope = `teamId=team_P85yMqd79TPq8aSGSt2kojWY&projectId=${vercelProjectId}`;

function readServingDeploymentId() {
  const alias = JSON.parse(
    command('vercel', ['api', `/v4/aliases/ogabassey.com?${vercelScope}`, '--method', 'GET'])
  );
  if (!/^dpl_[A-Za-z0-9]+$/.test(alias.deploymentId ?? '')) throw new Error('cannot identify the serving deployment');
  return alias.deploymentId;
}

export function assertVercelAccess(readAlias = readServingDeploymentId) {
  try {
    readAlias();
  } catch {
    throw new Error(
      'operator Vercel CLI must provide `vercel api` (>= 50.5.1) with production project access; upgrade vercel or re-authenticate and retry'
    );
  }
}

export async function waitForRunCompletion(runId, readStatus, options = {}) {
  const { pollMs = 10000, timeoutMs = 2700000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onWait = null } = options;
  const started = Date.now();
  for (;;) {
    const status = await readStatus();
    if (status === 'completed') return;
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`timed out waiting for workflow run ${runId} to complete; inspect the run before retrying`);
    }
    if (onWait) onWait(status, Date.now() - started);
    await sleep(pollMs);
  }
}

export function originRepoSlug(remoteUrl) {
  const withoutSuffix = String(remoteUrl ?? '').replace(/\/+$/, '').replace(/\.git$/, '');
  const match = /^(?:https?:\/\/github\.com[/]|git@github\.com:|ssh:\/\/git@github\.com[/])(.+)$/i.exec(withoutSuffix);
  return match ? match[1].toLowerCase() : '';
}

export function assertCanonicalOriginPushUrls(pushUrls) {
  const urls = String(pushUrls ?? '').split('\n').map(line => line.trim()).filter(Boolean);
  if (urls.length === 0 || !urls.every(url => originRepoSlug(url) === repository.toLowerCase())) {
    throw new Error('release checkout must use the canonical repository');
  }
}

export function assertCleanWorkerDeployEnv(env = process.env) {
  if (env.BACI_DEPLOY_SKIP_INFLIGHT_CHECK === '1') {
    throw new Error('refusing release with BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1; unset it so worker promotion stays strict');
  }
  if (env.BACI_DEPLOY_WORKFLOW_REPO) {
    throw new Error(`refusing release with BACI_DEPLOY_WORKFLOW_REPO=${env.BACI_DEPLOY_WORKFLOW_REPO}; unset it so promotion queries the canonical repository`);
  }
}

export function shouldHoldReleaseLock(error) {
  return error?.indeterminateDispatch === true;
}

export function assertRemovableLockPath(lockPath) {
  if (basename(resolve(lockPath)) !== 'baci-production-release.lock') {
    throw new Error(`refusing to remove unexpected lock path: ${lockPath}`);
  }
}

// Pagination is manual and capped: one gh call per page, each holding at
// most 100 full run objects (~400KB, inside the default 1MB spawn
// buffer). gh's --paginate would concatenate the unbounded full
// history through a single buffer until ENOBUFS blocks every release.
// Five pages (500 runs) generously cover the newest-first windows
// every caller needs: the just-dispatched run, in-flight guards, and
// concurrent siblings are all minutes old.
export const RUNS_PAGE_SIZE = 100;
export const RUNS_MAX_PAGES = 5;

export function slimWorkflowRun(run) {
  return {
    databaseId: run.id, headSha: run.head_sha, status: run.status, event: run.event, title: run.display_title,
  };
}

export function readRuns(filter, paginate = false) {
  const runs = [];
  const lastPage = paginate ? RUNS_MAX_PAGES : 1;
  for (let page = 1; page <= lastPage; page++) {
    const payload = JSON.parse(gh(['api',
      `repos/${repository}/actions/workflows/deploy.yml/runs?branch=main&per_page=${RUNS_PAGE_SIZE}&page=${page}&${filter}`]));
    if (!Array.isArray(payload.workflow_runs)) {
      throw new Error(`workflow run listing for ${filter} returned no runs payload; inspect preceding gh diagnostics`);
    }
    runs.push(...payload.workflow_runs.map(slimWorkflowRun));
    if (payload.workflow_runs.length < RUNS_PAGE_SIZE) break;
  }
  return runs;
}

async function main() {
  if (process.argv.slice(2).join(' ') !== '--approve-production --approve-prebuilt-fallback') {
    throw new Error('requires --approve-production --approve-prebuilt-fallback; never run from a publishing workflow');
  }
  const commonDirectory = command('git', ['rev-parse', '--git-common-dir']);
  const lockPath = releaseLockPath(root, commonDirectory);
  // Live-alias verification shells to `vercel api` (shipped in CLI
  // 50.5.1). Preflight a real scoped read before acquiring the lock:
  // `--help` would pass without authentication, deferring auth
  // failures until after publication. A purely local precondition
  // failure must not leave a lock behind, and the probes need no
  // mutual exclusion.
  assertVercelAccess();
  assertCleanWorkerDeployEnv();
  acquireReleaseLock(lockPath);
  let holdLock = false;
  try {
    const result = await coordinateRelease({
      verifyCheckout: async () => {
        if (command('git', ['status', '--porcelain', '--untracked-files=all'])) throw new Error('release checkout must be clean');
        // Both directions: a forked pushurl would send the promote
        // barrier and record where production cannot see them, while a
        // forked fetch URL would make the worker in-flight guard query
        // the fork and miss active canonical runs. Without an explicit
        // pushurl the push query falls back to the fetch URL.
        if (originRepoSlug(command('git', ['remote', 'get-url', 'origin'])) !== repository.toLowerCase()) {
          throw new Error('release checkout must use the canonical repository');
        }
        assertCanonicalOriginPushUrls(command('git', ['remote', 'get-url', '--push', '--all', 'origin']));
        return command('git', ['rev-parse', 'HEAD']);
      },
      readMain: async () => gh(['api', `repos/${repository}/git/ref/heads/main`, '--jq', '.object.sha']),
      listRuns: async () => [...IN_FLIGHT_RUN_STATUSES]
        .flatMap(status => readRuns(`status=${status}`, true)),
      listCoordinatedRuns: async () => readRuns('event=workflow_dispatch', true),
      updateWorkers: async () => command('bash', ['vps-workers/deploy.sh'], false),
      verifyWorkers: async commit => command('ssh', ['-o', 'BatchMode=yes', workerHost,
        `BACI_EXPECTED_APP_SHA=${commit} bash /home/bassey/baci-workers/bin/verify-gigl-direct-workers-installed.sh --skip-live-smoke`], false),
      dispatch: async commit => gh(['workflow', 'run', 'deploy.yml', '--repo', repository, '--ref', 'main',
        '-f', `coordination_id=${coordinationId}`, '-f', `expected_release_sha=${commit}`]),
      findRun: async (_commit, baseline) => {
        for (let attempt = 0; attempt < 24; attempt++) {
          // Bounded pagination like listRuns: with 100+ recent
          // dispatches the new run can fall outside the first page,
          // which would wrongly report 'dispatch outcome unknown' on
          // a healthy run.
          const candidate = selectCoordinatedRun(readRuns('event=workflow_dispatch', true), baseline, coordinationId);
          if (candidate) return candidate;
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        throw new Error('dispatch outcome unknown; inspect GitHub before retrying');
      },
      // Poll the run endpoint, not `gh run watch`: watch requires
      // checks:read and cannot authenticate with fine-grained PATs,
      // while the Actions API reads work. Conclusion is asserted by
      // the readJobs check that follows.
      watchRun: async runId => waitForRunCompletion(
        runId,
        async () => {
          const status = JSON.parse(gh(['api', `repos/${repository}/actions/runs/${runId}`, '--jq', '.status']));
          if (typeof status !== 'string') {
            throw new Error(`workflow run ${runId} status unreadable; inspect preceding gh diagnostics`);
          }
          return status;
        },
        {
          onWait: (status, elapsedMs) =>
            process.stderr.write(`waiting on run ${runId}: ${status} (${Math.round(elapsedMs / 1000)}s)\n`),
        }
      ),
      cancelRun: async runId => gh(['run', 'cancel', String(runId), '--repo', repository]),
      readJobs: async runId => JSON.parse(gh(['run', 'view', String(runId), '--repo', repository, '--json', 'jobs'])).jobs,
      verifyLive: async commit => {
        const deploymentId = readServingDeploymentId();
        const deployment = JSON.parse(command('vercel', ['api', `/v13/deployments/${deploymentId}?${vercelScope}`, '--method', 'GET']));
        assertLiveDeployment(deployment, commit, vercelProjectId);
      },
    }, coordinationId);
    process.stdout.write(`${JSON.stringify({ ...result, status: 'live_release_verified' })}\n`);
  } catch (error) {
    if (shouldHoldReleaseLock(error)) {
      holdLock = true;
      process.stderr.write(`indeterminate dispatch outcome; release lock held at ${lockPath} — reconcile existing runs before removing it\n`);
    }
    throw error;
  } finally {
    if (!holdLock) {
      assertRemovableLockPath(lockPath);
      rmSync(lockPath, { recursive: true });
    }
  }
}

const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
