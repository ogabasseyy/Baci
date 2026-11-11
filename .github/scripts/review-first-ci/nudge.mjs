// The "nudge": when Codex turns clean (or ci-now / the timeout applies), re-run the
// pull request's own CI run so the second pass can run the heavy jobs.
//
// The nudge only decides WHEN to ask. The re-run's `changes` job reads the verdict
// again and decides for itself (resolve-stage.mjs), so a wrong or early nudge can
// waste a re-run of the quick checks but can never start the heavy suite.
import { evaluatePullRequestStage } from './evaluate-pr-stage.mjs';

export const STATUS_CONTEXT = 'Review-first CI';
export const MAX_ATTEMPTS = 3;
// The nudge waits this long past the timeout so the re-run's own clock (the pull
// request update time in its event) has certainly passed it too.
const TIMEOUT_MARGIN_MINUTES = 2;
const REQUIRED_NAMES = new Set(['Build', 'Quality Gate']);
const short = (sha) => String(sha).slice(0, 7);

const skip = (reason) => ({ action: 'skip', reason });

async function latestRun(client, repository, workflow, sha) {
  const runs = await client.paginate(`/repos/${repository}/actions/workflows/${workflow}/runs?head_sha=${sha}&event=pull_request`, 'workflow_runs');
  return runs.reduce((best, run) => (!best || run.run_number > best.run_number ? run : best), null);
}

async function setStatus({ client, repository, sha, state, description, url, dryRun, log }) {
  const body = { state, context: STATUS_CONTEXT, description: description.slice(0, 140), target_url: url };
  if (dryRun) return log(`[dry-run] status ${state}: ${body.description}`);
  try {
    await client.post(`/repos/${repository}/statuses/${sha}`, body);
  } catch (error) {
    log(`could not set the ${STATUS_CONTEXT} status: ${error.message}`);
  }
}

export async function nudgePullRequest({ client, repository, prNumber, mode, now = Date.now(), timeoutMinutes, dryRun = false, log = console.log }) {
  if (mode !== 'on' && mode !== 'pilot') return skip('mode-off');

  const pr = await client.get(`/repos/${repository}/pulls/${prNumber}`);
  if (pr.state !== 'open') return skip('closed');
  if (pr.head?.repo?.full_name !== repository) return skip('fork');
  if (pr.base?.ref !== 'main') return skip('not-main');
  const sha = pr.head.sha;

  const run = await latestRun(client, repository, 'ci.yml', sha);
  if (!run) return skip('no-ci-run-for-head');
  if (run.status !== 'completed') return skip('in-progress');
  if (run.conclusion !== 'success') return skip('quick-checks-did-not-pass');

  const jobs = await client.paginate(`/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest`, 'jobs');
  if (jobs.some((job) => REQUIRED_NAMES.has(job.name) && job.conclusion !== 'skipped')) return skip('already-full');

  const status = { client, repository, sha, url: run.html_url, dryRun, log };
  if (run.run_attempt >= MAX_ATTEMPTS) {
    await setStatus({ ...status, state: 'error', description: `Re-run limit reached for ${short(sha)}; add the ci-now label and re-run by hand` });
    return skip('attempt-cap');
  }

  const ageMinutes = (now - Date.parse(run.created_at)) / 60000 - TIMEOUT_MARGIN_MINUTES;
  const { decision } = await evaluatePullRequestStage({ client, repository, prNumber, headSha: sha, eventName: 'pull_request', mode, ageMinutes, timeoutMinutes });

  if (decision.stage !== 'full') {
    await setStatus({ ...status, state: 'pending', description: `Quick checks passed. ${decision.reason}` });
    return { action: 'wait', reason: decision.code, detail: decision.reason };
  }

  const browser = await latestRun(client, repository, 'checkout-browser.yml', sha);
  const targets = [run, ...(browser?.status === 'completed' ? [browser] : [])];
  for (const target of targets) {
    if (dryRun) log(`[dry-run] would re-run run ${target.id}`);
    else await client.post(`/repos/${repository}/actions/runs/${target.id}/rerun`, {});
  }
  await setStatus({ ...status, state: 'success', description: `Full CI requested (${decision.code}): ${decision.reason}` });
  return { action: 'rerun', reason: decision.code, detail: decision.reason, runs: targets.map((target) => target.id) };
}

export async function sweepRecentRuns({ client, repository, since, nudge, log = console.log }) {
  const runs = await client.paginate(
    `/repos/${repository}/actions/workflows/ci.yml/runs?event=pull_request&status=completed&created=${encodeURIComponent(`>=${since}`)}`,
    'workflow_runs'
  );
  const numbers = new Set();
  for (const run of runs) {
    const number = run.pull_requests?.[0]?.number;
    if (run.conclusion === 'success' && number) numbers.add(number);
  }
  const results = [];
  for (const prNumber of numbers) {
    try {
      results.push({ prNumber, ...(await nudge(prNumber)) });
    } catch (error) {
      log(`PR ${prNumber}: ${error.message}`);
      results.push({ prNumber, action: 'error', reason: error.message });
    }
  }
  return results;
}
