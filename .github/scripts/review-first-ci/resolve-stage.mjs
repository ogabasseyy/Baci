// Entry point of the `changes` job step "Resolve CI stage".
//
// Prints and writes `stage` (full | quick), `code` and `reason` for this run.
// `full` lets the heavy jobs run and gives Build / Quality Gate their real names;
// `quick` leaves them deferred. Anything surprising falls on the `quick` side and
// is announced with a warning annotation (fail closed).
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { evaluatePullRequestStage } from './evaluate-pr-stage.mjs';
import { createGithubClient } from './github-api.mjs';
import { BREAK_GLASS_LABEL, parseTimeoutMinutes } from './stage-decision.mjs';

const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();

function summaryFor(decision, headSha, timeoutMinutes) {
  const heading = decision.stage === 'full' ? 'Review-first CI: full CI' : 'Review-first CI: workflow safeguards only';
  const lines = [`## ${heading}`, '', '| | |', '| --- | --- |', `| Stage | \`${decision.stage}\` (${decision.code}) |`, `| Why | ${oneLine(decision.reason)} |`, `| Commit | \`${String(headSha).slice(0, 10)}\` |`, ''];
  if (decision.stage === 'quick') {
    lines.push(
      'Lint, typecheck, miscellaneous tests, mobile guardrails, test shards, mobile and shared tests, `Build`, DB replay and the browser regression start only once the PR is ready and Codex reports no major findings for this exact commit. `Build` and `Quality Gate` are deferred: GitHub shows them as missing, so merging stays blocked.',
      '',
      `* Wait: keep the PR draft until Codex and Muse are clean, then mark ready; full CI starts on its own.`,
      `* Break-glass (Codex down, or a finding was answered): on a ready PR, add the label \`${BREAK_GLASS_LABEL}\`. Drafts run safeguards only.`,
      `* No Codex verdict after ${timeoutMinutes} minutes on a ready PR starts the full CI anyway. Drafts never time out.`,
      ''
    );
  }
  return lines.join('\n');
}

export async function runResolveStage({ env, client, now = Date.now(), log = console.log }) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const pullRequest = event.pull_request ?? {};
  const headSha = pullRequest.head?.sha ?? '';
  const updatedAt = Date.parse(pullRequest.updated_at ?? '');
  const timeoutMinutes = parseTimeoutMinutes(env.BACI_CODEX_WAIT_TIMEOUT_MINUTES);

  const { decision } = await evaluatePullRequestStage({
    client: client ?? createGithubClient({ token: env.GITHUB_TOKEN, apiUrl: env.GITHUB_API_URL }),
    repository: env.GITHUB_REPOSITORY,
    prNumber: pullRequest.number,
    headSha,
    eventName: env.EVENT_NAME,
    mode: env.BACI_REVIEW_FIRST_CI,
    sameRepo: pullRequest.head?.repo?.full_name === env.GITHUB_REPOSITORY,
    ageMinutes: Number.isFinite(updatedAt) ? (now - updatedAt) / 60000 : 0,
    timeoutMinutes,
  });

  const reason = oneLine(decision.reason);
  log(`${decision.warn ? '::warning' : '::notice'} title=Review-first CI (${decision.stage})::${decision.code}: ${reason}`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `stage=${decision.stage}\ncode=${decision.code}\nreason=${reason}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summaryFor(decision, headSha, timeoutMinutes)}\n`);
  return decision;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runResolveStage({ env: process.env }).catch((error) => {
    console.error(`::error title=Review-first CI::${oneLine(error.message)}`);
    process.exit(1);
  });
}
