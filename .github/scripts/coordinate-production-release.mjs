import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function releaseLockPath(root, commonDirectory) {
  return resolve(root, commonDirectory, 'baci-production-release.lock');
}

export function acquireReleaseLock(lockPath) {
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`release lock held: ${lockPath}; confirm no release is running, then remove it`);
    }
    throw error;
  }
}

export function selectCoordinatedRun(runs, baseline, coordinationId) {
  const knownIds = new Set(baseline.map(run => run.databaseId));
  const candidates = runs.filter(run => !knownIds.has(run.databaseId) &&
    run.event === 'workflow_dispatch' && run.title === `Coordinated release ${coordinationId}`);
  // Dedupe by run ID before the ambiguity check: a run landing
  // mid-pagination can surface the same databaseId on two pages.
  const seen = new Set();
  const unique = candidates.filter(run => {
    if (seen.has(run.databaseId)) return false;
    seen.add(run.databaseId);
    return true;
  });
  if (unique.length > 1) throw new Error('ambiguous dispatch; reconcile workflow runs, do not redispatch');
  return unique[0] ?? null;
}

// Enumerated for the list-workflow-runs status filter AND the sibling
// classifier: a production run parked awaiting environment approval
// (action_required) is still an in-flight deployment that must block
// a second coordinator.
export const IN_FLIGHT_RUN_STATUSES = new Set([
  'queued',
  'in_progress',
  'waiting',
  'requested',
  'pending',
  'action_required',
]);

export function selectSiblingCoordinatedRuns(runs, baseline, coordinationId) {
  const knownIds = new Set(baseline.map(run => run.databaseId));
  return runs.filter(run => !knownIds.has(run.databaseId) &&
    run.event === 'workflow_dispatch' &&
    typeof run.title === 'string' && run.title.startsWith('Coordinated release ') &&
    run.title !== `Coordinated release ${coordinationId}` &&
    IN_FLIGHT_RUN_STATUSES.has(run.status));
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
  let run;
  try {
    run = await operations.findRun(commit, baseline);
  } catch (error) {
    // The dispatch was sent but its outcome is unknown: the caller
    // must hold the release lock for reconcile-before-removal instead
    // of auto-releasing it for an immediate rerun.
    if (error && typeof error === 'object') error.indeterminateDispatch = true;
    throw error;
  }
  if (!run) {
    const error = new Error('dispatch outcome unknown; inspect GitHub before retrying');
    error.indeterminateDispatch = true;
    throw error;
  }
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
  // race this release — on the same commit or a different one. An
  // in-flight sibling coordinated run aborts loudly instead,
  // cancelling our own run first, so a concurrent release can never
  // silently supersede this one. Best effort, not atomic:
  // near-simultaneous dispatches can list before the other's run is
  // API-visible, in which case both runs serialize in the workflow
  // concurrency queue and may publish sequentially. True mutual
  // exclusion needs the single outer coordinator from the unattended
  // integration boundary. Completed siblings are earlier releases,
  // not racers, and are ignored.
  const siblings = selectSiblingCoordinatedRuns(await operations.listCoordinatedRuns(), baseline, coordinationId);
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
  // gh run view reports the latest attempt's jobs for the single
  // non-matrixed deploy-production job, so exactly one success is the
  // green shape; re-runs supersede earlier attempts rather than
  // appending entries. Malformed listings refuse publication with the
  // same error instead of throwing a TypeError.
  if (!Array.isArray(jobs) || !jobs.every(job => job && typeof job.name === 'string' && typeof job.conclusion === 'string')) {
    throw new Error('production publication did not succeed; inspect the workflow');
  }
  if (jobs.filter(job => job.name === 'deploy-production' && job.conclusion === 'success').length !== 1) {
    throw new Error('production publication did not succeed; inspect the workflow');
  }
  await operations.verifyLive(commit);
  return { commit, runId: run.databaseId };
}

export function assertLiveDeployment(deployment, commit, projectId) {
  if (!deployment || typeof deployment !== 'object' || Array.isArray(deployment) ||
    deployment.projectId !== projectId || deployment.meta?.githubCommitSha !== commit ||
    deployment.readyState !== 'READY' || deployment.target !== 'production') {
    throw new Error('live production deployment does not match the verified release');
  }
}
