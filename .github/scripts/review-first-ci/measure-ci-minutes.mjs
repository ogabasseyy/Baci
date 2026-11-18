// Before/after measurement for review-first CI: hosted job-minutes per merged pull request.
//
//   GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=ogabasseyy/Baci \
//     node .github/scripts/review-first-ci/measure-ci-minutes.mjs --day 2026-11-10 --sample 40
//
// Billing model (same as the owner's earlier analysis): each job that ran on a GitHub-hosted
// runner is rounded UP to whole minutes (minimum 1); skipped jobs and self-hosted jobs cost
// nothing here. All attempts of a run count (a re-run is billed again). A sample of runs per
// workflow is read and scaled to the day's run count; use --sample 0 to read every run.
import { pathToFileURL } from 'node:url';
import { createGithubClient } from './github-api.mjs';

const HEAVY = [/^Quality Gate - Test/, /^Build$/, /^Quality Gate - DB Replay/, /^Quality Gate - Disposable SQL/, /^CWV Runner Contracts/, /^Checkout - Chromium/, /^Quality Gate$/];
const WORKFLOWS = ['ci.yml', 'checkout-browser.yml'];

export function billedMinutes(job) {
  if (job.conclusion === 'skipped' || !job.started_at || !job.completed_at) return 0;
  if ((job.labels ?? []).includes('self-hosted')) return 0;
  const seconds = (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000;
  return seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : 0;
}

export function classifyJob(name) {
  return HEAVY.some((pattern) => pattern.test(name)) ? 'heavy' : 'quick';
}

export function sampleRuns(runs, size, seed = 1) {
  if (!size || size >= runs.length) return [...runs];
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const copy = [...runs];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy.slice(0, size);
}

export function summarize({ runs, jobsByRun, totalRuns, mergedPullRequests }) {
  const scale = runs.length > 0 ? totalRuns / runs.length : 0;
  let quick = 0;
  let heavy = 0;
  let withHeavy = 0;
  for (const run of runs) {
    const jobs = jobsByRun.get(run.id) ?? [];
    let ranHeavy = false;
    for (const job of jobs) {
      const minutes = billedMinutes(job);
      if (classifyJob(job.name) === 'heavy') {
        heavy += minutes;
        if (minutes > 0) ranHeavy = true;
      } else quick += minutes;
    }
    if (ranHeavy) withHeavy += 1;
  }
  const quickMinutes = Math.round(quick * scale);
  const heavyMinutes = Math.round(heavy * scale);
  const totalMinutes = quickMinutes + heavyMinutes;
  return {
    runs: totalRuns,
    sampledRuns: runs.length,
    quickMinutes,
    heavyMinutes,
    totalMinutes,
    runsWithHeavyJobs: Math.round(withHeavy * scale),
    mergedPullRequests,
    minutesPerMergedPullRequest: mergedPullRequests > 0 ? Math.round(totalMinutes / mergedPullRequests) : null,
  };
}

export function formatReport(label, report) {
  return [
    `CI cost for ${label} (${report.sampledRuns} of ${report.runs} runs read, scaled)`,
    `  runs                         ${report.runs}`,
    `  runs that ran heavy jobs     ${report.runsWithHeavyJobs}`,
    `  quick-stage job-minutes      ${report.quickMinutes}`,
    `  heavy-stage job-minutes      ${report.heavyMinutes}`,
    `  total hosted job-minutes     ${report.totalMinutes}`,
    `  merged pull requests         ${report.mergedPullRequests}`,
    `  job-minutes per merged pull request  ${report.minutesPerMergedPullRequest ?? 'n/a'}`,
  ].join('\n');
}

async function measureDay({ client, repository, day, sample }) {
  const runs = [];
  for (const workflow of WORKFLOWS) {
    // The API returns at most 1000 runs per query, so read the day in hourly windows.
    for (let hour = 0; hour < 24; hour += 1) {
      const from = `${day}T${String(hour).padStart(2, '0')}:00:00Z`;
      const to = `${day}T${String(hour).padStart(2, '0')}:59:59Z`;
      const window = encodeURIComponent(`${from}..${to}`);
      runs.push(...(await client.paginate(`/repos/${repository}/actions/workflows/${workflow}/runs?created=${window}`, 'workflow_runs')));
    }
  }
  const sampled = sampleRuns(runs, sample);
  const jobsByRun = new Map();
  for (const run of sampled) {
    jobsByRun.set(run.id, await client.paginate(`/repos/${repository}/actions/runs/${run.id}/jobs?filter=all`, 'jobs'));
  }
  const search = await client.get(`/search/issues?q=${encodeURIComponent(`repo:${repository} is:pr is:merged merged:${day}`)}&per_page=1`);
  return summarize({ runs: sampled, jobsByRun, totalRuns: runs.length, mergedPullRequests: search.total_count ?? 0 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const day = option('--day');
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    console.error('usage: measure-ci-minutes.mjs --day YYYY-MM-DD [--sample N] [--json]');
    process.exit(2);
  }
  const client = createGithubClient({ token: process.env.GITHUB_TOKEN });
  const report = await measureDay({ client, repository: process.env.GITHUB_REPOSITORY ?? 'ogabasseyy/Baci', day, sample: Number.parseInt(option('--sample', '40'), 10) });
  console.log(args.includes('--json') ? JSON.stringify({ day, ...report }, null, 2) : formatReport(day, report));
}
