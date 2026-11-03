const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const PAGE_SIZE = 100;
const MAX_RUN_PAGES = 30;
const COMPARE_CONCURRENCY = 5;
// GITHUB_TOKEN allows ~1000 REST calls/hour/repository; leave room for the guard's other calls.
const MAX_REQUESTS = 800;
const COMPARE_STATUSES = new Set(['identical', 'behind', 'ahead', 'diverged']);

// Scans every deploy.yml run on main (no ordering or commit-date assumptions: both can be
// spoofed or reset) and fails closed past MAX_RUN_PAGES so history is never judged partially.
// Reports whether any strict descendant of expectedSha has deployed (or started deploying).
export async function descendantAlreadyDeployed({ apiRoot, expectedSha, fetchImpl, githubJson, repository, runHasDeployedProduction, token }) {
  let requests = 0;
  const getJson = (url) => {
    if (++requests > MAX_REQUESTS) throw new Error('deployment run scan exceeded request budget');
    return githubJson(fetchImpl, url, token);
  };
  const descendant = new Map();
  for (let page = 1; page <= MAX_RUN_PAGES; page++) {
    const body = await getJson(`${apiRoot}/repos/${repository}/actions/workflows/deploy.yml/runs?per_page=${PAGE_SIZE}&page=${page}`);
    if (
      !Array.isArray(body?.workflow_runs) ||
      (typeof body.total_count === 'number' && body.total_count > (page - 1) * PAGE_SIZE + body.workflow_runs.length && body.workflow_runs.length < PAGE_SIZE)
    ) {
      throw new Error('incomplete or invalid workflow runs response');
    }
    const runs = body.workflow_runs.filter((run) => {
      if (typeof run?.head_sha !== 'string' || !SHA_PATTERN.test(run.head_sha)) {
        throw new Error('invalid workflow run SHA');
      }
      return (run.head_branch == null || run.head_branch === 'main') && run.head_sha.toLowerCase() !== expectedSha.toLowerCase();
    });
    const fresh = [...new Set(runs.map((run) => run.head_sha.toLowerCase()))].filter((sha) => !descendant.has(sha));
    for (let i = 0; i < fresh.length; i += COMPARE_CONCURRENCY) {
      await Promise.all(fresh.slice(i, i + COMPARE_CONCURRENCY).map(async (sha) => {
        const cmp = await getJson(`${apiRoot}/repos/${repository}/compare/${expectedSha}...${sha}?per_page=1`);
        const base = cmp?.merge_base_commit?.sha;
        if (!COMPARE_STATUSES.has(cmp?.status) || typeof base !== 'string' || !SHA_PATTERN.test(base)) {
          throw new Error('incomplete descendant comparison');
        }
        descendant.set(sha, cmp.status === 'ahead' && base.toLowerCase() === expectedSha.toLowerCase());
      }));
    }
    for (const run of runs) {
      if (descendant.get(run.head_sha.toLowerCase()) && (await runHasDeployedProduction(fetchImpl, apiRoot, repository, run, token))) return true;
    }
    const exhausted = typeof body.total_count === 'number' ? page * PAGE_SIZE >= body.total_count : body.workflow_runs.length < PAGE_SIZE;
    if (exhausted || body.workflow_runs.length < PAGE_SIZE) return false;
  }
  throw new Error('could not exhaust deployment run history');
}
