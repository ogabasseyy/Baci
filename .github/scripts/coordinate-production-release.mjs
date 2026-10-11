import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Step inside deploy-production that promotes to Vercel (deploy.yml).
// Pinned by contract test against the workflow file: a rename must
// update this constant or post-promotion failures go undetected.
export const DEPLOY_PROMOTE_STEP_NAME = 'Deploy to Vercel (with retry)';

export function releaseLockPath(root, commonDirectory) {
  return resolve(root, commonDirectory, 'baci-production-release.lock');
}

export function acquireReleaseLock(lockPath) {
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`release lock held: ${lockPath}; confirm no release is running on this machine (the lock is local-only and says nothing about other machines), then remove it`);
    }
    throw error;
  }
}

export function selectCoordinatedRun(runs, baseline, coordinationId, commit = null) {
  const knownIds = new Set(baseline.map(run => run.databaseId));
  // Titles are operator-set display strings: when the release commit is
  // known, require it too, so a planted same-title run on another SHA
  // is ignored instead of forcing the mismatch-cancel path. A planted
  // same-title same-SHA run still degrades to ambiguous/indeterminate
  // (release-blocking, never a wrong release). The id is unguessable
  // only until first dispatch — deploy.yml publishes it in the run
  // title, visible to run readers — so planting needs dispatch
  // permission plus a disclosed id, and can only DoS, never divert.
  const candidates = runs.filter(run => !knownIds.has(run.databaseId) &&
    run.event === 'workflow_dispatch' && run.title === `Coordinated release ${coordinationId}` &&
    (commit === null || run.headSha === commit));
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
  // Re-check main immediately before dispatch: dispatch pins --ref
  // main, so a tip advance since the baseline would orphan a run that
  // SHA-filtered discovery can never correlate (and that only the
  // workflow's own verifier gate would stop). Untagged: nothing has
  // been dispatched yet, so the lock releases for a clean retry.
  if (await operations.readMain() !== commit) throw new Error('main changed; dispatch refused, prepare a clean current checkout');
  // Dispatch, discovery, and observation of the known run are the
  // indeterminate window: once the dispatch request is sent, any
  // failure (lost response, unknown outcome, ambiguity, unreadable
  // status) means a run may exist or publish unseen, so the caller
  // must hold the release lock for reconcile-before-removal instead
  // of auto-releasing it for an immediate rerun.
  const tagIndeterminate = error => {
    if (error && typeof error === 'object') error.indeterminateDispatch = true;
    throw error;
  };
  let run;
  try {
    await operations.dispatch(commit);
    run = await operations.findRun(commit, baseline);
  } catch (error) {
    tagIndeterminate(error);
  }
  if (!run) {
    const error = new Error('dispatch outcome unknown; inspect GitHub before retrying');
    error.indeterminateDispatch = true;
    throw error;
  }
  if (!Number.isSafeInteger(run.databaseId) || run.databaseId <= 0) {
    tagIndeterminate(new Error('invalid dispatch run identity'));
  }
  if (run.headSha !== commit) {
    try {
      await operations.cancelRun(run.databaseId);
    } catch (error) {
      const detail = error && typeof error === 'object' && error.message ? `: ${error.message}` : '';
      const mismatch = new Error(`dispatch commit mismatch; cancellation failed${detail}; reconcile before retrying`);
      mismatch.indeterminateDispatch = true;
      throw mismatch;
    }
    // Cancel is 202 Accepted, not proof of termination: the run may
    // still publish, so retain the lock for reconciliation.
    tagIndeterminate(new Error('dispatch commit mismatch; cancellation accepted, run may still publish; reconcile before retrying'));
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
  let siblings;
  try {
    siblings = selectSiblingCoordinatedRuns(await operations.listCoordinatedRuns(), baseline, coordinationId);
  } catch (error) {
    tagIndeterminate(error);
  }
  if (siblings.length > 0) {
    try {
      await operations.cancelRun(run.databaseId);
    } catch (error) {
      const detail = error && typeof error === 'object' && error.message ? `: ${error.message}` : '';
      const abort = new Error(`concurrent coordination detected; our-run cancellation failed${detail}; reconcile before retrying`);
      abort.indeterminateDispatch = true;
      throw abort;
    }
    // Cancel is 202 Accepted, not proof of termination: our run may
    // still publish, so retain the lock for reconciliation.
    tagIndeterminate(new Error('concurrent coordination detected; our-run cancellation accepted, run may still publish; reconcile before retrying'));
  }
  let jobs;
  try {
    await operations.watchRun(run.databaseId);
    jobs = await operations.readJobs(run.databaseId);
  } catch (error) {
    tagIndeterminate(error);
  }
  // gh run view reports the latest attempt's jobs for the single
  // non-matrixed deploy-production job, so exactly one success is the
  // green shape; re-runs supersede earlier attempts rather than
  // appending entries. Malformed listings refuse publication with the
  // same error instead of throwing a TypeError.
  if (!Array.isArray(jobs) || !jobs.every(job => job && typeof job.name === 'string' && typeof job.conclusion === 'string')) {
    throw new Error('production publication did not succeed; inspect the workflow');
  }
  if (jobs.filter(job => job.name === 'deploy-production' && job.conclusion === 'success').length !== 1) {
    // A deploy-production job whose promotion step ran may already have
    // changed production even when the step failed: deploy-with-retry
    // documents ambiguous promote failures (server-side effect with a
    // client-side error, e.g. unreachable alias lookup or failed
    // overlap recovery), and postdeploy migrations, coherence checks,
    // and smokes all run after the promotion step. Hold the lock so the
    // next release cannot start before the live alias and failed work
    // are reconciled. Only a promote step that never ran (absent or
    // skipped) or a wholly skipped job definitively did not publish.
    for (const job of jobs) {
      if (job.name !== 'deploy-production' || job.conclusion === 'success') continue;
      const promoteRan = !Array.isArray(job.steps)
        ? job.conclusion !== 'skipped'
        : job.steps.some(step => step && step.name === DEPLOY_PROMOTE_STEP_NAME && step.conclusion !== 'skipped');
      if (promoteRan) {
        const error = new Error('production publication may have succeeded; reconcile the live alias and failed post-promotion work before retrying');
        error.indeterminateDispatch = true;
        throw error;
      }
    }
    throw new Error('production publication did not succeed; inspect the workflow');
  }
  // verifyLive runs after a confirmed publication: any failure —
  // unreadable alias state or a definitive live mismatch — means
  // production needs reconciliation before the next release, so hold
  // the lock instead of freeing it for an immediate rerun.
  try {
    await operations.verifyLive(commit);
  } catch (error) {
    tagIndeterminate(error);
  }
  // Re-read main after the multi-hour watch: a push interleaving the
  // release can land our stale commit last, so alias == commit while
  // production sits behind tip. Refuse silent success — hold the lock
  // so the operator reconciles (and re-releases tip) deliberately.
  // An unreadable tip fails closed for the same reason.
  try {
    if (await operations.readMain() !== commit) {
      tagIndeterminate(new Error('main advanced during release; production serves the release commit behind tip; reconcile and re-release tip'));
    }
  } catch (error) {
    tagIndeterminate(error);
  }
  return { commit, runId: run.databaseId };
}

export function assertLiveDeployment(deployment, commit, projectId) {
  // CLI prebuilt deployments carry gitCommitSha (auto-attached from
  // the checkout), not githubCommitSha (git-integration deploys
  // only): verified live on the production deployment, whose meta
  // has gitCommitSha with source cli and no githubCommitSha. Accept
  // either so verification matches the field the deploy path sets —
  // but never silently prefer one: both present with conflicting
  // values is ambiguous provenance, so fail closed.
  const githubSha = deployment?.meta?.githubCommitSha ?? null;
  const gitSha = deployment?.meta?.gitCommitSha ?? null;
  const conflict = githubSha !== null && gitSha !== null && githubSha !== gitSha;
  const deployedSha = githubSha ?? gitSha;
  if (!deployment || typeof deployment !== 'object' || Array.isArray(deployment) ||
    deployment.projectId !== projectId || conflict || deployedSha !== commit ||
    deployment.readyState !== 'READY' || deployment.target !== 'production') {
    throw new Error('live production deployment does not match the verified release');
  }
}
