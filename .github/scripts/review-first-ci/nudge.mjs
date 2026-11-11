// The "nudge": when Codex turns clean (or ci-now / the timeout applies), re-run the
// pull request's own CI run so the second pass can run the heavy jobs.
//
// The nudge only decides WHEN to ask. The re-run's `changes` job reads the verdict
// again and decides for itself (resolve-stage.mjs), so a wrong or early nudge can
// waste a re-run of the quick checks but can never start the heavy suite.
import { evaluatePullRequestStage } from './evaluate-pr-stage.mjs';
import { normalizeMode } from './stage-decision.mjs';

export const STATUS_CONTEXT = 'Review-first CI';
export const MAX_ATTEMPTS = 3;
// The nudge waits this long past the timeout so the re-run's own clock (the pull
// request update time in its event) has certainly passed it too.
const TIMEOUT_MARGIN_MINUTES = 2;
const short = (sha) => String(sha).slice(0, 7);

// The two workflows that have a deferred full stage, and the job whose conclusion tells
// whether that stage ran (a skipped one means "still deferred").
const WORKFLOWS = [
  { file: 'ci.yml', heavyJobs: new Set(['Build', 'Quality Gate']) },
  { file: 'checkout-browser.yml', heavyJobs: new Set(['Checkout - Chromium and WebKit']) },
];

const skip = (reason) => ({ action: 'skip', reason });

async function latestRun(client, repository, workflow, sha) {
  const runs = await client.paginate(`/repos/${repository}/actions/workflows/${workflow}/runs?head_sha=${sha}&event=pull_request`, 'workflow_runs');
  return runs.reduce((best, run) => (!best || run.run_number > best.run_number ? run : best), null);
}

// Where does the pull request's run of one workflow stand?
//   in-progress | did-not-pass | quick (finished, heavy jobs still deferred) | full (heavy jobs ran)
async function inspect(client, repository, workflow, sha) {
  const run = await latestRun(client, repository, workflow.file, sha);
  if (!run) return null;
  if (run.status !== 'completed') return { run, state: 'in-progress' };
  if (run.conclusion !== 'success') return { run, state: 'did-not-pass' };
  const jobs = await client.paginate(`/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest`, 'jobs');
  const ran = jobs.some((job) => workflow.heavyJobs.has(job.name) && job.conclusion !== 'skipped');
  return { run, state: ran ? 'full' : 'quick' };
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
  if (!['on', 'pilot'].includes(normalizeMode(mode))) return skip('mode-off');

  const pr = await client.get(`/repos/${repository}/pulls/${prNumber}`);
  if (pr.state !== 'open') return skip('closed');
  if (pr.head?.repo?.full_name !== repository) return skip('fork');
  if (pr.base?.ref !== 'main') return skip('not-main');
  const sha = pr.head.sha;

  // Each workflow is tracked on its own: the browser regression can still be deferred while the
  // CI run is already full (or the other way round), and each finished run needs its own re-run.
  const [ci, browser] = await Promise.all(WORKFLOWS.map((workflow) => inspect(client, repository, workflow, sha)));
  if (!ci) return skip('no-ci-run-for-head');
  if (ci.state === 'did-not-pass') return skip('quick-checks-did-not-pass');
  const deferred = [ci, browser].filter((entry) => entry?.state === 'quick');
  if (deferred.length === 0) return skip([ci, browser].some((entry) => entry?.state === 'in-progress') ? 'in-progress' : 'already-full');

  const status = { client, repository, sha, url: ci.run.html_url, dryRun, log };
  const targets = deferred.filter((entry) => entry.run.run_attempt < MAX_ATTEMPTS).map((entry) => entry.run);
  if (targets.length === 0) {
    await setStatus({ ...status, state: 'error', description: `Re-run limit reached for ${short(sha)}; add the ci-now label and re-run by hand` });
    return skip('attempt-cap');
  }

  const ageMinutes = (now - Date.parse(ci.run.created_at)) / 60000;
  const { decision } = await evaluatePullRequestStage({ client, repository, prNumber, headSha: sha, eventName: 'pull_request', mode, ageMinutes, timeoutMinutes, now, marginMinutes: TIMEOUT_MARGIN_MINUTES, pullRequest: pr });

  if (decision.stage !== 'full') {
    await setStatus({ ...status, state: 'pending', description: `Quick checks passed. ${decision.reason}` });
    return { action: 'wait', reason: decision.code, detail: decision.reason };
  }

  for (const target of targets) {
    if (dryRun) log(`[dry-run] would re-run run ${target.id}`);
    else await client.post(`/repos/${repository}/actions/runs/${target.id}/rerun`, {});
  }
  await setStatus({ ...status, state: 'success', description: `Full CI requested (${decision.code}): ${decision.reason}` });
  return { action: 'rerun', reason: decision.code, detail: decision.reason, runs: targets.map((target) => target.id) };
}

// Pull requests marked ready in the window. A draft can sit for hours before that, so its run may
// be far older than the window; the ready event is what starts its no-verdict clock.
async function recentReadyPullRequests(client, repository, sinceMs) {
  const numbers = [];
  try {
    for (let page = 1; page <= 5; page += 1) {
      const events = await client.get(`/repos/${repository}/issues/events?per_page=100&page=${page}`);
      for (const event of events) {
        if (Date.parse(event.created_at) < sinceMs) return numbers;
        if (event.event === 'ready_for_review' && event.issue?.pull_request) numbers.push(event.issue.number);
      }
      if (events.length < 100) break;
    }
  } catch {
    // informational: the run-based part of the sweep still works
  }
  return numbers;
}

// Below this many remaining API requests the sweep stops: every workflow shares one hourly
// budget for the default token (1,000 per repository), and the event-driven paths matter more.
const MIN_API_BUDGET = 150;

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
  for (const number of await recentReadyPullRequests(client, repository, Date.parse(since))) numbers.add(number);
  const results = [];
  for (const prNumber of numbers) {
    const remaining = client.rateRemaining?.();
    if (remaining != null && remaining < MIN_API_BUDGET) {
      log(`sweep stopped: only ${remaining} GitHub API requests left this hour`);
      break;
    }
    try {
      results.push({ prNumber, ...(await nudge(prNumber)) });
    } catch (error) {
      log(`PR ${prNumber}: ${error.message}`);
      results.push({ prNumber, action: 'error', reason: error.message });
    }
  }
  return results;
}
