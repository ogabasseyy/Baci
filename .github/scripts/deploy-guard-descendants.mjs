const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const PAGE_SIZE = 100;
const MAX_RUN_PAGES = 30;

// Scans every deploy.yml run on main (no ordering or commit-date assumptions: both can be
// spoofed or reset) and fails closed past MAX_RUN_PAGES so history is never judged partially.
// Reports whether any strict descendant of expectedSha has deployed (or started deploying).
export async function descendantAlreadyDeployed({ apiRoot, expectedSha, fetchImpl, githubJson, repository, runHasDeployedProduction, token }) {
  const descendant = new Map();
  for (let page = 1; page <= MAX_RUN_PAGES; page++) {
    const body = await githubJson(
      fetchImpl,
      `${apiRoot}/repos/${repository}/actions/workflows/deploy.yml/runs?branch=main&per_page=${PAGE_SIZE}&page=${page}`,
      token
    );
    if (
      !Array.isArray(body?.workflow_runs) ||
      (typeof body.total_count === 'number' && body.total_count > (page - 1) * PAGE_SIZE + body.workflow_runs.length && body.workflow_runs.length < PAGE_SIZE)
    ) {
      throw new Error('incomplete or invalid workflow runs response');
    }
    for (const run of body.workflow_runs) {
      if (typeof run?.head_sha !== 'string' || !SHA_PATTERN.test(run.head_sha)) {
        throw new Error('invalid workflow run SHA');
      }
      if (run.head_branch != null && run.head_branch !== 'main') continue;
      const sha = run.head_sha.toLowerCase();
      if (sha === expectedSha.toLowerCase()) continue;
      if (!descendant.has(sha)) {
        const cmp = await githubJson(fetchImpl, `${apiRoot}/repos/${repository}/compare/${expectedSha}...${sha}?per_page=1`, token);
        if (typeof cmp?.status !== 'string' || typeof cmp?.merge_base_commit?.sha !== 'string') {
          throw new Error('incomplete descendant comparison');
        }
        descendant.set(sha, cmp.status === 'ahead' && cmp.merge_base_commit.sha.toLowerCase() === expectedSha.toLowerCase());
      }
      if (descendant.get(sha) && (await runHasDeployedProduction(fetchImpl, apiRoot, repository, run, token))) return true;
    }
    if (body.workflow_runs.length < PAGE_SIZE) return false;
  }
  throw new Error('could not exhaust deployment run history');
}
