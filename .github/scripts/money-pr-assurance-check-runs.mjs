// Reads the head commit's check runs and tags each with the workflow file
// whose run produced it. Any workflow can name a job "Quality Gate - DB
// Replay", so a required check only counts from its configured workflow.

function workflowFile(path) {
  // Workflow-run paths may carry an "@ref" suffix.
  return path ? String(path).split('@')[0] : null;
}

export async function readCheckRuns(client, { owner, repo, sha }) {
  const prefix = `/repos/${owner}/${repo}`;
  const workflowRuns = await client.getAll(
    `${prefix}/actions/runs?head_sha=${sha}&per_page=100`,
    'workflow_runs'
  );
  const suites = new Map(
    workflowRuns.map((run) => [run.check_suite_id, workflowFile(run.path)])
  );
  const checkRuns = await client.getAll(
    `${prefix}/commits/${sha}/check-runs?per_page=100`,
    'check_runs'
  );
  return checkRuns.map((run) => ({
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion ?? null,
    startedAt: run.started_at ?? '',
    workflowPath: suites.get(run.check_suite?.id) ?? null,
  }));
}
