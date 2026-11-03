const SHA_PATTERN = /^[0-9a-f]{40}$/i;

const MAX_RUN_PAGES = 10;

// Walks deploy.yml runs on main newest-first (the whole history, not just up to expectedSha's run), and reports
// whether any strict descendant of expectedSha has deployed (or started deploying).
export async function descendantAlreadyDeployed({ apiRoot, expectedSha, fetchImpl, githubJson, repository, runHasDeployedProduction, token }) {
  const checked = new Map();
  for (let page = 1; page <= MAX_RUN_PAGES; page++) {
    const body = await githubJson(
      fetchImpl,
      `${apiRoot}/repos/${repository}/actions/workflows/deploy.yml/runs?branch=main&per_page=100&page=${page}`,
      token
    );
    if (!Array.isArray(body?.workflow_runs)) throw new Error('incomplete or invalid workflow runs response');
    for (const run of body.workflow_runs) {
      if (typeof run?.head_sha !== 'string' || !SHA_PATTERN.test(run.head_sha)) {
        throw new Error('invalid workflow run SHA');
      }
      if (run.head_branch != null && run.head_branch !== 'main') continue;
      const sha = run.head_sha.toLowerCase();
      if (sha === expectedSha.toLowerCase()) continue;
      if (!(await runHasDeployedProduction(fetchImpl, apiRoot, repository, run, token))) continue;
      if (checked.has(sha)) continue;
      checked.set(sha, true);
      const cmp = await githubJson(
        fetchImpl,
        `${apiRoot}/repos/${repository}/compare/${expectedSha}...${sha}?per_page=1`,
        token
      );
      if (
        cmp?.status === 'ahead' &&
        cmp?.merge_base_commit?.sha?.toLowerCase() === expectedSha.toLowerCase()
      ) {
        return true;
      }
    }
    if (body.workflow_runs.length < 100) return false;
  }
  throw new Error('could not exhaust deployment run history');
}
