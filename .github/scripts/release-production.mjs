import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLiveDeployment, coordinateRelease, releaseLockPath, selectCoordinatedRun } from './coordinate-production-release.mjs';

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
  if (result.error || result.status !== 0) throw new Error(`${binary} failed; inspect preceding diagnostics`);
  return capture ? result.stdout.trim() : '';
}

function gh(args) {
  return command('gh', args);
}

export function originRepoSlug(remoteUrl) {
  const withoutSuffix = String(remoteUrl ?? '').replace(/\.git$/, '');
  const match = /^(?:https?:\/\/github\.com[/]|git@github\.com:|ssh:\/\/git@github\.com[/])(.+)$/i.exec(withoutSuffix);
  return match ? match[1].toLowerCase() : '';
}

function readRuns(filter, paginate = false) {
  const output = gh(['api', `repos/${repository}/actions/workflows/deploy.yml/runs?branch=main&per_page=100&${filter}`,
    ...(paginate ? ['--paginate', '--slurp'] : [])]);
  const pages = paginate ? JSON.parse(output) : [JSON.parse(output)];
  return pages.flatMap(page => page.workflow_runs.map(run => ({
    databaseId: run.id, headSha: run.head_sha, status: run.status, event: run.event, title: run.display_title,
  })));
}

async function main() {
  if (process.argv.slice(2).join(' ') !== '--approve-production --approve-prebuilt-fallback') {
    throw new Error('requires --approve-production --approve-prebuilt-fallback; never run from a publishing workflow');
  }
  const commonDirectory = command('git', ['rev-parse', '--git-common-dir']);
  const lockPath = releaseLockPath(root, commonDirectory);
  mkdirSync(lockPath);
  try {
    const result = await coordinateRelease({
      verifyCheckout: async () => {
        if (command('git', ['status', '--porcelain', '--untracked-files=all'])) throw new Error('release checkout must be clean');
        if (originRepoSlug(command('git', ['remote', 'get-url', 'origin'])) !== repository.toLowerCase()) {
          throw new Error('release checkout must use the canonical repository');
        }
        return command('git', ['rev-parse', 'HEAD']);
      },
      readMain: async () => gh(['api', `repos/${repository}/git/ref/heads/main`, '--jq', '.object.sha']),
      listRuns: async () => ['queued', 'in_progress', 'waiting', 'requested', 'pending']
        .flatMap(status => readRuns(`status=${status}`, true)),
      listCoordinatedRuns: async () => readRuns('event=workflow_dispatch', true),
      updateWorkers: async () => command('bash', ['vps-workers/deploy.sh'], false),
      verifyWorkers: async commit => command('ssh', ['-o', 'BatchMode=yes', workerHost,
        `BACI_EXPECTED_APP_SHA=${commit} bash /home/bassey/baci-workers/bin/verify-gigl-direct-workers-installed.sh --skip-live-smoke`], false),
      dispatch: async commit => gh(['workflow', 'run', 'deploy.yml', '--repo', repository, '--ref', 'main',
        '-f', `coordination_id=${coordinationId}`, '-f', `expected_release_sha=${commit}`]),
      findRun: async (_commit, baseline) => {
        for (let attempt = 0; attempt < 24; attempt++) {
          // Paginated like listRuns: with 100+ recent dispatches the new
          // run can fall outside the first page, which would wrongly
          // report 'dispatch outcome unknown' on a healthy run.
          const candidate = selectCoordinatedRun(readRuns('event=workflow_dispatch', true), baseline, coordinationId);
          if (candidate) return candidate;
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        throw new Error('dispatch outcome unknown; inspect GitHub before retrying');
      },
      watchRun: async runId => command('gh', ['run', 'watch', String(runId), '--repo', repository, '--exit-status'], false),
      cancelRun: async runId => gh(['run', 'cancel', String(runId), '--repo', repository]),
      readJobs: async runId => JSON.parse(gh(['run', 'view', String(runId), '--repo', repository, '--json', 'jobs'])).jobs,
      verifyLive: async commit => {
        const projectId = 'prj_y6kGI7ZzyFWU6tyZbaklPtVsXeqx';
        const scope = `teamId=team_P85yMqd79TPq8aSGSt2kojWY&projectId=${projectId}`;
        const alias = JSON.parse(command('vercel', ['api', `/v4/aliases/ogabassey.com?${scope}`, '--method', 'GET']));
        if (!/^dpl_[A-Za-z0-9]+$/.test(alias.deploymentId ?? '')) throw new Error('cannot identify the serving deployment');
        const deployment = JSON.parse(command('vercel', ['api', `/v13/deployments/${alias.deploymentId}?${scope}`, '--method', 'GET']));
        assertLiveDeployment(deployment, commit, projectId);
      },
    }, coordinationId);
    process.stdout.write(`${JSON.stringify({ ...result, status: 'live_release_verified' })}\n`);
  } finally {
    rmSync(lockPath, { recursive: true });
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
