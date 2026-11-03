const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
// GITHUB_TOKEN allows ~1000 REST calls/hour/repository; leave room for the guard's other calls.
const MAX_REQUESTS = 800;

// The expected...current compare lists exactly the commits that supersede expectedSha, so the
// descendant set comes from paging that one compare (commits only; later pages carry no files).
// Every deploy.yml run is then matched against that set, with no ordering or date assumptions.
// Reports whether any superseding commit has deployed (or started deploying).
export async function descendantAlreadyDeployed({ apiRoot, comparison, currentSha, expectedSha, fetchImpl, githubJson, repository, runHasDeployedProduction, token }) {
  let requests = 0;
  const counted = (url, options) => {
    if (++requests > MAX_REQUESTS) throw new Error('deployment run scan exceeded request budget');
    return fetchImpl(url, options);
  };
  const pages = Math.ceil(comparison.total_commits / PAGE_SIZE);
  if (pages > MAX_PAGES || !Array.isArray(comparison.commits)) throw new Error('incomplete superseding commit list');
  const descendants = new Set();
  const add = (commits) => {
    for (const commit of commits) {
      if (typeof commit?.sha !== 'string' || !SHA_PATTERN.test(commit.sha)) throw new Error('invalid superseding commit SHA');
      descendants.add(commit.sha.toLowerCase());
    }
  };
  add(comparison.commits);
  for (let page = 2; page <= pages; page++) {
    const next = await githubJson(counted, `${apiRoot}/repos/${repository}/compare/${expectedSha}...${currentSha}?per_page=${PAGE_SIZE}&page=${page}`, token);
    if (!Array.isArray(next?.commits)) throw new Error('incomplete superseding commit list');
    add(next.commits);
  }
  if (descendants.size !== comparison.total_commits) throw new Error('incomplete superseding commit list');
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await githubJson(counted, `${apiRoot}/repos/${repository}/actions/workflows/deploy.yml/runs?per_page=${PAGE_SIZE}&page=${page}`, token);
    const runs = body?.workflow_runs;
    if (!Array.isArray(runs) || (typeof body.total_count === 'number' && body.total_count > (page - 1) * PAGE_SIZE + runs.length && runs.length < PAGE_SIZE)) {
      throw new Error('incomplete or invalid workflow runs response');
    }
    for (const run of runs) {
      if (run?.head_branch != null && run.head_branch !== 'main') continue;
      if (typeof run?.head_sha !== 'string' || !SHA_PATTERN.test(run.head_sha)) throw new Error('invalid workflow run SHA');
      if (!descendants.has(run.head_sha.toLowerCase()) || seen.has(run.id)) continue;
      seen.add(run.id);
      if (await runHasDeployedProduction(counted, apiRoot, repository, run, token)) return true;
    }
    if (typeof body.total_count === 'number' ? page * PAGE_SIZE >= body.total_count : runs.length < PAGE_SIZE) return false;
    if (runs.length < PAGE_SIZE) return false;
  }
  throw new Error('could not exhaust deployment run history');
}
