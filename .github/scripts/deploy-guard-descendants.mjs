const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const PAGE_SIZE = 100;
// Each superseding commit costs ~2 requests (runs + jobs). On the success path the guard scans
// about 3 times per deploy (attempt, promote, postdeploy; the pre-build run has a small gap), and
// GITHUB_TOKEN allows ~1000 REST calls/hour/repository, so one scan gets a third of that: ~150
// superseding commits. Retry attempts only follow a failure and can exceed the hourly allowance;
// the guard then refuses (fails closed) rather than judge a partial history.
const MAX_COMMITS = 150;
const LOOKUP_CONCURRENCY = 5;
const MAX_REQUESTS = 330;

// The expected...current compare lists exactly the commits that supersede expectedSha, so the
// descendant set comes from paging that one compare (commits only; later pages carry no files).
// Each superseding commit's deploy.yml runs are then looked up by head_sha, with no ordering or
// date assumptions. Reports whether any superseding commit has deployed (or started deploying).
export async function descendantAlreadyDeployed({ apiRoot, comparison, currentSha, expectedSha, fetchImpl, githubJson, repository, runHasDeployedProduction, token }) {
  let requests = 0;
  const counted = (url, options) => {
    if (++requests > MAX_REQUESTS) throw new Error('deployment run scan exceeded request budget');
    return fetchImpl(url, options);
  };
  const pages = Math.ceil(comparison.total_commits / PAGE_SIZE);
  if (comparison.total_commits > MAX_COMMITS) throw new Error('too many superseding commits for the request budget');
  if (!Array.isArray(comparison.commits)) throw new Error('incomplete superseding commit list');
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
    if (!Array.isArray(next?.commits) || next.status !== 'ahead' || next.total_commits !== comparison.total_commits) throw new Error('incomplete superseding commit list');
    add(next.commits);
  }
  if (descendants.size !== comparison.total_commits || !descendants.has(currentSha.toLowerCase()) || descendants.has(expectedSha.toLowerCase())) {
    throw new Error('incomplete superseding commit list');
  }
  // Newest first, a few at a time: runs are looked up per superseding SHA, so the all-time
  // size of the workflow's history never matters (it already exceeds any page cap).
  const shas = [...descendants].reverse();
  for (let i = 0; i < shas.length; i += LOOKUP_CONCURRENCY) {
    const batch = await Promise.all(shas.slice(i, i + LOOKUP_CONCURRENCY).map(async (sha) => {
      const body = await githubJson(counted, `${apiRoot}/repos/${repository}/actions/workflows/deploy.yml/runs?head_sha=${sha}&branch=main&per_page=${PAGE_SIZE}`, token);
      if (!Array.isArray(body?.workflow_runs) || (typeof body.total_count === 'number' && body.total_count > body.workflow_runs.length)) {
        throw new Error('incomplete or invalid workflow runs response');
      }
      return body.workflow_runs.filter((run) => run?.head_branch == null || run.head_branch === 'main');
    }));
    for (const run of batch.flat()) {
      if (typeof run?.head_sha !== 'string' || !SHA_PATTERN.test(run.head_sha)) throw new Error('invalid workflow run SHA');
      if (!descendants.has(run.head_sha.toLowerCase())) continue;
      if (await runHasDeployedProduction(counted, apiRoot, repository, run, token)) return true;
    }
  }
  return false;
}
