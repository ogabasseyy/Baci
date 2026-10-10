import { resolve } from 'node:path';

export function releaseLockPath(root, commonDirectory) {
  return resolve(root, commonDirectory, 'baci-production-release.lock');
}

export function selectCoordinatedRun(runs, baseline, coordinationId) {
  const knownIds = new Set(baseline.map(run => run.databaseId));
  const candidates = runs.filter(run => !knownIds.has(run.databaseId) &&
    run.event === 'workflow_dispatch' && run.title === `Coordinated release ${coordinationId}`);
  if (candidates.length > 1) throw new Error('ambiguous dispatch; reconcile workflow runs, do not redispatch');
  return candidates[0] ?? null;
}

const IN_FLIGHT_RUN_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

export function selectSiblingCoordinatedRuns(runs, baseline, coordinationId, commit) {
  const knownIds = new Set(baseline.map(run => run.databaseId));
  return runs.filter(run => !knownIds.has(run.databaseId) &&
    run.event === 'workflow_dispatch' &&
    typeof run.title === 'string' && run.title.startsWith('Coordinated release ') &&
    run.title !== `Coordinated release ${coordinationId}` &&
    IN_FLIGHT_RUN_STATUSES.has(run.status) &&
    run.headSha === commit);
}

export async function coordinateRelease(operations, coordinationId) {
  const commit = await operations.verifyCheckout();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('invalid release commit');
  if (await operations.readMain() !== commit) throw new Error('main changed; prepare a clean current checkout');
  const before = await operations.listRuns();
  if (before.some(run => run.status !== 'completed')) throw new Error('production deployment in flight');
  await operations.updateWorkers(commit);
  await operations.verifyWorkers(commit);
  if (await operations.readMain() !== commit) throw new Error('main changed during worker preparation; publication refused');
  const baseline = await operations.listRuns();
  if (baseline.some(run => run.status !== 'completed')) throw new Error('production deployment in flight');
  await operations.dispatch(commit);
  const run = await operations.findRun(commit, baseline);
  if (!run) throw new Error('dispatch outcome unknown; inspect GitHub before retrying');
  if (!Number.isSafeInteger(run.databaseId) || run.databaseId <= 0) throw new Error('invalid dispatch run identity');
  if (run.headSha !== commit) {
    try {
      await operations.cancelRun(run.databaseId);
    } catch {
      // Best effort: a failed cancel (run already completed) must not
      // mask the original commit-mismatch error.
    }
    throw new Error('dispatch commit mismatch; cancellation requested');
  }
  // The lock is local, so a second coordinator on another machine can
  // race this release: both would watch a dispatch and report a
  // release. An in-flight sibling coordinated run for the same commit
  // aborts loudly instead — cancelling our own run first so exactly
  // one release can complete. Completed siblings are earlier releases
  // of the same SHA, not racers, and are ignored.
  const siblings = selectSiblingCoordinatedRuns(await operations.listCoordinatedRuns(), baseline, coordinationId, commit);
  if (siblings.length > 0) {
    try {
      await operations.cancelRun(run.databaseId);
    } catch {
      // Best effort: the abort must report the race, not the cancel.
    }
    throw new Error('concurrent coordination detected; release aborted');
  }
  await operations.watchRun(run.databaseId);
  const jobs = await operations.readJobs(run.databaseId);
  if (jobs.filter(job => job.name === 'deploy-production' && job.conclusion === 'success').length !== 1) {
    throw new Error('production publication did not succeed; inspect the workflow');
  }
  await operations.verifyLive(commit);
  return { commit, runId: run.databaseId };
}

export function assertLiveDeployment(deployment, commit, projectId) {
  if (deployment.projectId !== projectId || deployment.meta?.githubCommitSha !== commit ||
    deployment.readyState !== 'READY' || deployment.target !== 'production') {
    throw new Error('live production deployment does not match the verified release');
  }
}
