const ID_RE = /^[1-9][0-9]{0,19}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const WORKFLOW = '.github/workflows/production-release.yml';
const WORKFLOW_PATHS = [WORKFLOW, `${WORKFLOW}@main`, `${WORKFLOW}@refs/heads/main`];

/** Prove the exact worker coordinator attempt stored in root-owned recovery metadata has ended. */
export async function proveCompletedWorkerAttempt({ target, repository, workflowId, runnerLabel, apiJson }) {
  const runId = String(target?.run_id ?? target?.runId ?? '');
  const runAttempt = Number(target?.run_attempt ?? target?.runAttempt);
  const sha = target?.sha;
  const requestedJobId = target?.job_id ?? target?.jobId;
  if (!ID_RE.test(runId) || !Number.isSafeInteger(runAttempt) || runAttempt < 1 || !SHA_RE.test(sha ?? '') ||
      (requestedJobId !== undefined && !ID_RE.test(String(requestedJobId))) ||
      typeof repository !== 'string' || !repository || !Number.isSafeInteger(workflowId) ||
      typeof runnerLabel !== 'string' || !runnerLabel || typeof apiJson !== 'function') {
    throw new Error('worker recovery target is invalid');
  }
  const run = await apiJson(`/repos/${repository}/actions/runs/${runId}`);
  if (run?.id !== Number(runId) || run.workflow_id !== workflowId || !WORKFLOW_PATHS.includes(run.path) ||
      !['push', 'workflow_dispatch'].includes(run.event) || run.head_branch !== 'main' || run.head_sha !== sha ||
      !Number.isSafeInteger(run.run_attempt) || run.run_attempt < runAttempt ||
      (run.run_attempt === runAttempt && run.status !== 'completed')) {
    throw new Error('worker recovery coordinator attempt is not terminal');
  }
  const page = await apiJson(`/repos/${repository}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`);
  if (!Array.isArray(page?.jobs) || page.jobs.length === 0 || page.jobs.length > 100 ||
      (Number.isSafeInteger(page.total_count) && page.total_count !== page.jobs.length) ||
      page.jobs.some((job) => job?.status !== 'completed')) {
    throw new Error('worker recovery attempt still has active jobs');
  }
  const candidates = page.jobs.filter((job) => requestedJobId === undefined
    ? job?.name === 'Sync VPS workers'
    : job?.id === Number(requestedJobId));
  if (candidates.length !== 1) throw new Error('worker recovery coordinator job is ambiguous');
  const job = candidates[0];
  if (job.run_id !== Number(runId) || job.name !== 'Sync VPS workers' || job.status !== 'completed' ||
      job.head_sha !== sha || !Array.isArray(job.labels) || !job.labels.includes(runnerLabel) ||
      typeof job.runner_name !== 'string' || job.runner_name.length === 0) {
    throw new Error('worker recovery coordinator job does not match its durable identity');
  }
  return { run_id: runId, run_attempt: runAttempt, sha, job_id: String(job.id) };
}
